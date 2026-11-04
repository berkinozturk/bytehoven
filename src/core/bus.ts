/** Tiny typed event emitter. */
export class Emitter<T extends Record<string, unknown>> {
  private handlers: { [K in keyof T]?: Array<(payload: T[K]) => void> } = {};

  on<K extends keyof T>(type: K, fn: (payload: T[K]) => void): () => void {
    (this.handlers[type] ??= []).push(fn);
    return () => {
      this.handlers[type] = this.handlers[type]?.filter((h) => h !== fn);
    };
  }

  emit<K extends keyof T>(type: K, payload: T[K]): void {
    for (const h of this.handlers[type] ?? []) h(payload);
  }
}
