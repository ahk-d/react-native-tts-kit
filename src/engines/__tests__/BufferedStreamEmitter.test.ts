import { BufferedStreamEmitter } from '../BufferedStreamEmitter';

describe('BufferedStreamEmitter', () => {
  it('delivers chunks emitted before any listener attaches', () => {
    const emitter = new BufferedStreamEmitter();
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    emitter.emitChunk(a);
    emitter.emitChunk(b);

    const received: Uint8Array[] = [];
    emitter.on('chunk', (pcm) => received.push(pcm));

    expect(received).toEqual([a, b]);
  });

  it('forwards live chunks once a listener is attached', () => {
    const emitter = new BufferedStreamEmitter();
    const received: Uint8Array[] = [];
    emitter.on('chunk', (pcm) => received.push(pcm));

    const a = new Uint8Array([7]);
    emitter.emitChunk(a);
    expect(received).toEqual([a]);
  });

  it('replays a buffered end event to a late-attaching listener', () => {
    const emitter = new BufferedStreamEmitter();
    emitter.emitEnd();
    const fn = jest.fn();
    emitter.on('end', fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire end when a listener is already attached', () => {
    const emitter = new BufferedStreamEmitter();
    const fn = jest.fn();
    emitter.on('end', fn);
    emitter.emitEnd();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('replays a buffered error to a late-attaching listener', () => {
    const emitter = new BufferedStreamEmitter();
    const err = new Error('boom');
    emitter.emitError(err);
    const fn = jest.fn();
    emitter.on('error', fn);
    expect(fn).toHaveBeenCalledWith(err);
  });

  it('drains pending chunks only once', () => {
    const emitter = new BufferedStreamEmitter();
    const a = new Uint8Array([1]);
    emitter.emitChunk(a);
    const fn = jest.fn();
    emitter.on('chunk', fn);
    expect(fn).toHaveBeenCalledTimes(1);

    // Add a second listener — it should NOT see the already-drained chunk.
    const fn2 = jest.fn();
    emitter.on('chunk', fn2);
    expect(fn2).not.toHaveBeenCalled();
  });
});
