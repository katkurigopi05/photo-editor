/**
 * Classifying an incoming file as image, video or audio.
 *
 * The browser's MIME type is the first choice, but it is not dependable: files
 * dragged from some applications, and anything the OS has no mapping for,
 * arrive with `type: ""` or `application/octet-stream`. Falling back to the
 * extension keeps a dropped .mov from being treated as an image and failing to
 * decode — or, worse, being silently ignored by the drop handler.
 *
 * Listing an extension here is a claim about what kind of thing it is, not a
 * promise the browser can decode it. Whether a given build plays HEVC in a
 * .mov, or opens .heic, is decided at decode time, and the import path reports
 * failures from there.
 */

export type MediaKind = "image" | "video" | "audio";

export const EXTENSION_KINDS: Record<string, MediaKind> = {
  // images
  png: "image",
  jpg: "image",
  jpeg: "image",
  jfif: "image",
  webp: "image",
  gif: "image",
  bmp: "image",
  avif: "image",
  svg: "image",
  ico: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
  heif: "image",
  // video
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  mpg: "video",
  mpeg: "video",
  ogv: "video",
  // audio
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  oga: "audio",
  opus: "audio",
  flac: "audio",
  weba: "audio",
  aiff: "audio",
  aif: "audio",
};

/** The parts of a File this module needs — keeps it testable without one. */
export interface NamedFile {
  name: string;
  type: string;
}

/** Lower-cased extension, or "" when the name has none. A leading dot with no
 * stem (".gitignore") is a hidden file, not an extension. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Kind from the MIME type where there is one, else from the extension.
 * Unknown files fall through to "image": it is the cheapest thing to attempt
 * and the decode failure is reported plainly. */
export function detectKind(file: NamedFile): MediaKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  return EXTENSION_KINDS[fileExtension(file.name)] ?? "image";
}

/** Whether a dropped file is worth attempting at all. */
export function isMediaFile(file: NamedFile): boolean {
  if (/^(image|video|audio)\//.test(file.type)) return true;
  return fileExtension(file.name) in EXTENSION_KINDS;
}
