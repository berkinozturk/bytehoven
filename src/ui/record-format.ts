/** Format choices for "Today's symphony" recordings. No imports, so the tests run it directly. */

/** One minute is plenty for a clip to share, and keeps the file small. */
export const MAX_SECONDS = 60;

const FORMATS = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];

/** The first format this browser can record (Chrome/Firefox: WebM, Safari: MP4), or null. */
export function pickMime(supports: (mime: string) => boolean): string | null {
  return FORMATS.find((m) => supports(m)) ?? null;
}

const two = (n: number) => String(n).padStart(2, '0');

export function recordingName(d: Date, mime: string): string {
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return `bytehoven-symphony-${day}-${two(d.getHours())}${two(d.getMinutes())}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}
