import type { Readable } from 'node:stream';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export const SHUTDOWN_SIGNALS: readonly ShutdownSignal[] = ['SIGINT', 'SIGTERM'];
const STDIN_CLOSE_EVENTS = ['end', 'close'] as const;

/** The subset of `process` used to subscribe to shutdown signals. */
export interface SignalSource {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

export interface ShutdownTriggers {
  readonly signals: SignalSource;
  readonly stdin: Readable;
}

/**
 * Calls `onTrigger(reason)` on SIGINT, SIGTERM, or when the MCP client closes stdin.
 * Returns a function that removes every listener it registered.
 */
export function registerShutdownTriggers(
  triggers: ShutdownTriggers,
  onTrigger: (reason: string) => void,
): () => void {
  const signalListeners = SHUTDOWN_SIGNALS.map((signal) => {
    const listener = (): void => {
      onTrigger(signal);
    };
    triggers.signals.on(signal, listener);
    return { signal, listener };
  });

  const onStdinClosed = (): void => {
    onTrigger('stdin closed');
  };
  for (const event of STDIN_CLOSE_EVENTS) {
    triggers.stdin.once(event, onStdinClosed);
  }

  return () => {
    for (const { signal, listener } of signalListeners) {
      triggers.signals.off(signal, listener);
    }
    for (const event of STDIN_CLOSE_EVENTS) {
      triggers.stdin.off(event, onStdinClosed);
    }
  };
}
