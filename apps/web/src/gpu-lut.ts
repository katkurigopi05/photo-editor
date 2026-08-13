import { LUT_SIZE, type Lut3d } from "@director/raster-tools";

/**
 * Applying a 3D colour table on the GPU.
 *
 * Every grading effect in this app is `getImageData` → JS loop → `putImageData`
 * on one thread. `isLutable` already collapses a pointwise stack into a single
 * 33³ table, so the remaining per-pixel cost is one trilinear lookup — eight
 * reads and seven interpolations per pixel in `applyLut3d`.
 *
 * That lookup is what sampling hardware *is*. A `sampler3D` with `LINEAR`
 * filtering does trilinear interpolation in one fetch, for every pixel at once.
 * So this moves the part that scales with resolution and leaves the part that
 * does not — building the table — exactly where it was, in the same code, so
 * the two paths still cannot drift apart.
 *
 * This lives in `apps/web` rather than `raster-tools` on purpose: raster-tools
 * is pure and runs under Node in the unit suite, and a WebGL dependency would
 * end that.
 *
 * **This is not assumed to be faster.** Headless Chromium's WebGL2 is
 * SwiftShader — a software rasteriser — so a green test here proves the picture
 * is right, never that the GPU was used or that it won. Speed has to be measured
 * on real hardware and reported as a measurement.
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
uniform vec2 uResolution;
uniform float uSize;

out vec4 outColour;

void main() {
  // gl_FragCoord is centred on the pixel and the y axis runs the other way
  // from an ImageData's rows, so the source is read flipped and written back
  // flipped, leaving the picture the right way up.
  vec2 uv = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uResolution;
  vec4 src = texture(uImage, uv);

  // The same mapping applyLut3d does: a channel in 0..1 lands on sample
  // c * (size - 1). The half-texel offset converts a sample *index* into the
  // texture coordinate that reads that sample's centre — without it every
  // lookup is skewed by half a cell and the whole grade shifts.
  vec3 index = src.rgb * (uSize - 1.0);
  vec3 coord = (index + 0.5) / uSize;

  outColour = vec4(texture(uLut, coord).rgb, src.a);
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

export interface GpuLutRenderer {
  /** Grade `source` through `lut`, or null if the draw failed — in which case
   * the caller runs the CPU path rather than showing a wrong picture. */
  apply(
    source: CanvasImageSource,
    width: number,
    height: number,
    lut: Lut3d,
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
  const uResolution = gl.getUniformLocation(program, "uResolution");
  const uSize = gl.getUniformLocation(program, "uSize");

  const imageTex = gl.createTexture();
  const lutTex = gl.createTexture();
  const vao = gl.createVertexArray();
  if (imageTex === null || lutTex === null || vao === null) return null;

  // The table is uploaded only when it changes. A slider drag re-grades every
  // frame with the same picture and a new table; a still frame re-draws with
  // the same table. Keying on identity catches both without hashing 100k bytes.
  let uploadedLut: Lut3d | null = null;

  const apply = (
    source: CanvasImageSource,
    width: number,
    height: number,
    lut: Lut3d,
  ): HTMLCanvasElement | null => {
    if (width <= 0 || height <= 0) return null;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.bindVertexArray(vao);
    gl.useProgram(program);
    gl.viewport(0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source as TexImageSource,
    );

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTex);
    if (uploadedLut !== lut) {
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // Clamping matters at the ends of the range: wrapping would make pure
      // white sample the black end of the cube.
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
    }

    gl.uniform1i(uImage, 0);
    gl.uniform1i(uLut, 1);
    gl.uniform2f(uResolution, width, height);
    gl.uniform1f(uSize, LUT_SIZE);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.getError() !== gl.NO_ERROR) return null;
    return canvas;
  };

  return {
    canvas,
    apply,
    dispose: () => {
      gl.deleteTexture(imageTex);
      gl.deleteTexture(lutTex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      uploadedLut = null;
    },
  };
}
