import { TimeoutError } from './errors.js';

export interface TimeoutOptions {
  /** Parent signal. Aborting it cancels the operation with the parent's reason. */
  signal?: AbortSignal;
}

/**
 * Runs `operation` with a deadline.
 *
 * The operation receives an AbortSignal that fires on timeout or when the parent signal aborts,
 * so cancellable work (fetch, streams, timers) is actually stopped instead of left running.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  { signal }: TimeoutOptions = {},
): Promise<T> {
  signal?.throwIfAborted();

  const controller = new AbortController();
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });

  const onParentAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new TimeoutError(timeoutMs)), timeoutMs);

  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}
