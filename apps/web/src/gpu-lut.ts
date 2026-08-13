import { LUT_SIZE, type Lut3d } from "@director/raster-tools";

/**
 * Applying colour tables on the GPU, in sequence, each through its own mask.
 *
 * Every grading effect in this app began as `getImageData` → JS loop →
 * `putImageData` on one thread. A *pointwise* effect is a pure function from RGB
 * to RGB, so it collapses into a 33³ table and costs one trilinear lookup per
 * pixel — and a trilinear lookup is what sampling hardware is. A `sampler3D`
 * with `LINEAR` filtering does in one fetch what `applyLut3d` does with eight
 * reads and seven interpolations.
 *
 * **One pass per effect, not one pass per stack.** It is tempting to compose a
 * masked stack into a single table, and it would be wrong: the CPU path applies
 * each effect and blends it through its mask before the next one sees the
 * pixels, so where a mask is feathered `blend(blend(x, A), B)` is not
 * `blend(x, B∘A)`. Only an *unmasked* run may be collapsed, which the caller
 * does before it gets here. Matching the sequence is what keeps the two paths
 * showing the same picture.
 *
 * The tables are still built on the CPU by the same grading code as before, so
 * nothing is reimplemented and nothing can drift. Only the per-pixel part — the
 * part that grows with resolution — moved.
 *
 * This lives in `apps/web` rather than `raster-tools` because raster-tools is
 * pure and runs under Node in the unit suite; a WebGL dependency would end that.
 *
 * **Not assumed to be faster.** Headless Chromium's WebGL2 is SwiftShader, a
 * software rasteriser, so a green test proves the picture is right and never
 * that the GPU was used or that it won. Speed is measured on real hardware and
 * reported as a measurement.
 */

const VERTEX_SRC = `#version 300 es
// A single triangle covering the clip volume: cheaper than two, and no seam
// along the diagonal where a quad's triangles meet.
void main() {
  vec2 xy = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(xy * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler2D uImage;
uniform sampler3D uLut;
uniform sampler2D uCoverage;
uniform vec2 uResolution;
uniform float uSize;
// Coverage is a real texture even when unmasked (a 1x1 white pixel would still
// cost a fetch), so a flag decides rather than a sample.
uniform bool uMasked;
// Only the pass that reads the original picture flips. Intermediate passes read
// a framebuffer this shader already wrote, which is in GL's orientation, and
// flipping again would stand the picture back on its head.
uniform bool uFlipY;

out vec4 outColour;

void main() {
  vec2 xy = uFlipY
    ? vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y)
    : gl_FragCoord.xy;
  vec2 uv = xy / uResolution;
  vec4 src = texture(uImage, uv);

  // The same mapping applyLut3d does: a channel in 0..1 lands on sample
  // c * (size - 1). The half-texel offset converts a sample *index* into the
  // texture coordinate that reads that sample's centre — without it every
  // lookup is skewed by half a cell and the whole grade shifts. That error is
  // about the size of one cell's rounding, which is why the parity test's
  // tolerance had to be measured rather than argued.
  vec3 index = src.rgb * (uSize - 1.0);
  vec3 coord = (index + 0.5) / uSize;
  vec3 graded = texture(uLut, coord).rgb;

  // Coverage is sampled in the *source's* orientation, because it is rasterised
  // by the CPU against the same rows an ImageData has.
  float cover = uMasked
    ? texture(uCoverage, vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uResolution).r
    : 1.0;

  // Alpha is carried through untouched: a colour table never changes it, and
  // blending it against itself would only introduce rounding.
  outColour = vec4(mix(src.rgb, graded, cover), src.a);
}`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** One effect: its colour table, and the region it applies to. */
export interface LutPass {
  lut: Lut3d;
  /** Single-channel coverage, `width * height`, 0–255 — the same buffer
   * `rasterizeClipMask` produces. Absent means the whole frame. */
  coverage?: Uint8ClampedArray;
}

export interface GpuLutRenderer {
  /** Run `passes` in order over `source`, or null if the draw failed — in which
   * case the caller runs the CPU path rather than showing a wrong picture. */
  applyChain(
    source: CanvasImageSource,
    width: number,
    height: number,
    passes: readonly LutPass[],
  ): HTMLCanvasElement | null;
  /** Free the context's resources. A WebGL context is a scarce browser-wide
   * handle, not ordinary garbage. */
  dispose(): void;
  readonly canvas: HTMLCanvasElement;
}

/**
 * Build a renderer, or return null where WebGL2 is unavailable.
 *
 * Null is a normal answer, not a failure: the CPU path is complete and correct
 * on its own, and this is only ever an accelerator. Anything that cannot be
 * established — no context, a shader that will not compile, a link error — ends
 * as null here rather than as a broken frame later.
 */
export function createGpuLutRenderer(): GpuLutRenderer | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (gl === null) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (vs === null || fs === null) return null;

  const program = gl.createProgram();
  if (program === null) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return null;
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const uImage = gl.getUniformLocation(program, "uImage");
  const uLut = gl.getUniformLocation(program, "uLut");
  const uCoverage = gl.getUniformLocation(program, "uCoverage");
  const uResolution = gl.getUniformLocation(program, "uResolution");
  const uSize = gl.getUniformLocation(program, "uSize");
  const uMasked = gl.getUniformLocation(program, "uMasked");
  const uFlipY = gl.getUniformLocation(program, "uFlipY");

  const imageTex = gl.createTexture();
  const lutTex = gl.createTexture();
  const coverageTex = gl.createTexture();
  const vao = gl.createVertexArray();
  if (
    imageTex === null ||
    lutTex === null ||
    coverageTex === null ||
    vao === null
  ) {
    return null;
  }

  // Two ping-pong targets. A pass cannot read and write one texture, so the
  // chain alternates; the last pass draws to the canvas instead.
  const ping: (WebGLTexture | null)[] = [
    gl.createTexture(),
    gl.createTexture(),
  ];
  const fbo: (WebGLFramebuffer | null)[] = [
    gl.createFramebuffer(),
    gl.createFramebuffer(),
  ];
  if (ping.some((t) => t === null) || fbo.some((f) => f === null)) return null;
  let pingSize = { width: 0, height: 0 };

  const clampedRgba = (texture: WebGLTexture): void => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  const resizePing = (width: number, height: number): void => {
    if (pingSize.width === width && pingSize.height === height) return;
    for (let i = 0; i < 2; i += 1) {
      clampedRgba(ping[i]!);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]!);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        ping[i]!,
        0,
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    pingSize = { width, height };
  };

  // The table is re-uploaded only when it changes. A slider drag re-grades the
  // same picture with a new table; a still frame re-draws with the same one.
  // Identity catches both without hashing 100k bytes. Reset per chain because
  // successive passes carry different tables through the same texture.
  let uploadedLut: Lut3d | null = null;

  const uploadLut = (lut: Lut3d): void => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTex);
    if (uploadedLut === lut) return;
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Clamping matters at the ends of the range: wrapping would make pure white
    // sample the black end of the cube.
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    // RGB8 rows are 3 bytes wide and the default unpack alignment of 4 would
    // read them skewed — every row shifted a little further than the last.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB8,
      LUT_SIZE,
      LUT_SIZE,
      LUT_SIZE,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      new Uint8Array(lut.buffer, lut.byteOffset, lut.length),
    );
    uploadedLut = lut;
  };

  const uploadCoverage = (
    coverage: Uint8ClampedArray,
    width: number,
    height: number,
  ): void => {
    gl.activeTexture(gl.TEXTURE2);
    clampedRgba(coverageTex);
    // R8 rows are one byte wide, so alignment matters here for the same reason
    // it does for the table.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array(coverage.buffer, coverage.byteOffset, coverage.length),
    );
  };

  const applyChain = (
    source: CanvasImageSource,
    width: number,
    height: number,
    passes: readonly LutPass[],
  ): HTMLCanvasElement | null => {
    if (width <= 0 || height <= 0 || passes.length === 0) return null;
    for (const pass of passes) {
      if (
        pass.coverage !== undefined &&
        pass.coverage.length !== width * height
      ) {
        return null;
      }
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (passes.length > 1) resizePing(width, height);
    uploadedLut = null;

    gl.bindVertexArray(vao);
    gl.useProgram(program);
    gl.disable(gl.BLEND);
    gl.uniform2f(uResolution, width, height);
    gl.uniform1f(uSize, LUT_SIZE);
    gl.uniform1i(uImage, 0);
    gl.uniform1i(uLut, 1);
    gl.uniform1i(uCoverage, 2);

    // The original picture goes straight to the GPU: reading it back with
    // getImageData first would pay the cost this exists to avoid.
    gl.activeTexture(gl.TEXTURE0);
    clampedRgba(imageTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source as TexImageSource,
    );

    for (let i = 0; i < passes.length; i += 1) {
      const pass = passes[i]!;
      const last = i === passes.length - 1;

      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : fbo[i % 2]!);
      gl.viewport(0, 0, width, height);

      gl.activeTexture(gl.TEXTURE0);
      // The first pass reads the uploaded picture; every later one reads what
      // its predecessor wrote.
      gl.bindTexture(gl.TEXTURE_2D, i === 0 ? imageTex : ping[(i - 1) % 2]!);
      gl.uniform1i(uFlipY, i === 0 ? 1 : 0);

      uploadLut(pass.lut);

      gl.uniform1i(uMasked, pass.coverage === undefined ? 0 : 1);
      if (pass.coverage !== undefined) {
        uploadCoverage(pass.coverage, width, height);
      } else {
        // A sampler still has to be bound to something valid even when unused,
        // or some drivers treat the draw as incomplete.
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, coverageTex);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.getError() !== gl.NO_ERROR) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return null;
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return canvas;
  };

  return {
    canvas,
    applyChain,
    dispose: () => {
      gl.deleteTexture(imageTex);
      gl.deleteTexture(lutTex);
      gl.deleteTexture(coverageTex);
      for (const t of ping) gl.deleteTexture(t);
      for (const f of fbo) gl.deleteFramebuffer(f);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      uploadedLut = null;
    },
  };
}
