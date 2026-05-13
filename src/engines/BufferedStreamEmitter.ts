/**
 * Per-stream emitter that buffers events emitted before any listener attaches.
 *
 * The native side of `stream()` starts producing chunks the moment we kick it
 * off, but the JS caller usually attaches `.on('chunk')` immediately after —
 * there's a small async gap. Without buffering, early chunks would be silently
 * dropped. Once a listener is attached, queued events drain to it.
 *
 * This class is exported separately from SupertonicEngine so it can be unit
 * tested without needing the native module to load.
 */
export class BufferedStreamEmitter {
  private chunkListeners: Array<(pcm: Uint8Array) => void> = [];
  private endListeners: Array<() => void> = [];
  private errorListeners: Array<(err: Error) => void> = [];
  private pendingChunks: Uint8Array[] = [];
  private pendingEnd = false;
  private pendingError: Error | null = null;

  on(event: 'chunk', listener: (pcm: Uint8Array) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'chunk' | 'end' | 'error', listener: (...args: any[]) => void): void {
    if (event === 'chunk') {
      this.chunkListeners.push(listener);
      const drained = this.pendingChunks;
      this.pendingChunks = [];
      for (const pcm of drained) listener(pcm);
    } else if (event === 'end') {
      this.endListeners.push(listener);
      if (this.pendingEnd) { this.pendingEnd = false; listener(); }
    } else if (event === 'error') {
      this.errorListeners.push(listener);
      if (this.pendingError) { const e = this.pendingError; this.pendingError = null; listener(e); }
    }
  }

  emitChunk(pcm: Uint8Array): void {
    if (this.chunkListeners.length === 0) { this.pendingChunks.push(pcm); return; }
    for (const l of this.chunkListeners) l(pcm);
  }
  emitEnd(): void {
    if (this.endListeners.length === 0) { this.pendingEnd = true; return; }
    for (const l of this.endListeners) l();
  }
  emitError(err: Error): void {
    if (this.errorListeners.length === 0) { this.pendingError = err; return; }
    for (const l of this.errorListeners) l(err);
  }
}
