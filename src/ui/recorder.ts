import { MAX_SECONDS, pickMime, recordingName } from './record-format';

/**
 * "Today's symphony": records the stage and the sound into one video file the
 * browser can play and share. Everything stays on this machine; the file is
 * simply downloaded.
 */
export class Recorder {
  /** Called when recording starts, every second while it runs, and when it stops. */
  onTick: (seconds: number | null) => void = () => {};
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer = 0;
  private mime: string | null;

  constructor() {
    this.mime = typeof MediaRecorder === 'undefined' ? null : pickMime((m) => MediaRecorder.isTypeSupported(m));
  }

  get supported() {
    return !!this.mime && 'captureStream' in HTMLCanvasElement.prototype;
  }

  get recording() {
    return !!this.rec;
  }

  start(canvas: HTMLCanvasElement, audio: MediaStream) {
    if (this.rec || !this.mime) return;
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...audio.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 4_000_000 });
    this.rec = rec;
    this.chunks = [];
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => {
      stream.getVideoTracks().forEach((t) => t.stop());
      this.save(new Blob(this.chunks, { type: this.mime! }));
      this.chunks = [];
    };
    rec.start(1000);
    const t0 = performance.now();
    this.onTick(0);
    this.timer = window.setInterval(() => {
      const s = Math.floor((performance.now() - t0) / 1000);
      if (s >= MAX_SECONDS) return this.stop();
      this.onTick(s);
    }, 250);
  }

  stop() {
    if (!this.rec) return;
    clearInterval(this.timer);
    this.rec.stop();
    this.rec = null;
    this.onTick(null);
  }

  private save(blob: Blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = recordingName(new Date(), this.mime!);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
}
