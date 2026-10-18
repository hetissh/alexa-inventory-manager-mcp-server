import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { registerShutdownTriggers, type ShutdownSignal } from '../../src/lifecycle.js';

function setup(): {
  signals: EventEmitter;
  stdin: PassThrough;
  onTrigger: ReturnType<typeof vi.fn<(reason: string) => void>>;
  unregister: () => void;
} {
  const signals = new EventEmitter();
  const stdin = new PassThrough();
  const onTrigger = vi.fn<(reason: string) => void>();
  const unregister = registerShutdownTriggers({ signals, stdin }, onTrigger);
  return { signals, stdin, onTrigger, unregister };
}

describe('registerShutdownTriggers', () => {
  it.each<ShutdownSignal>(['SIGINT', 'SIGTERM'])('triggers on %s', (signal) => {
    const { signals, onTrigger } = setup();
    signals.emit(signal);
    expect(onTrigger).toHaveBeenCalledExactlyOnceWith(signal);
  });

  it.each(['end', 'close'])('triggers when stdin emits %s', (event) => {
    const { stdin, onTrigger } = setup();
    stdin.emit(event);
    expect(onTrigger).toHaveBeenCalledExactlyOnceWith('stdin closed');
  });

  it('removes all of its listeners when unregistered', () => {
    const { signals, stdin, onTrigger, unregister } = setup();
    unregister();
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    stdin.emit('end');
    stdin.emit('close');
    expect(onTrigger).not.toHaveBeenCalled();
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
});
