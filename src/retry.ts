import { sleep } from './sleep.js';

export type Jitter = 'full' | 'none';

export interface RetryContext {
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  error: unknown;
  /** Delay before the next attempt, in milliseconds. */
  delayMs: number;
}

export interface BackoffOptions {
  /** Delay before the first retry. Default: 100ms. */
  baseDelayMs: number;
  /** Upper bound for any single delay. Default: 10s. */
  maxDelayMs: number;
  /** Exponential growth factor. Default: 2. */
  factor: number;
  /**
   * `full` picks a random delay in [0, computed) ("full jitter"), which spreads retries from
   * many clients and avoids thundering herds. `none` is deterministic. Default: `full`.
   */
  jitter: Jitter;
}

export interface RetryOptions extends Partial<BackoffOptions> {
  /** Total number of attempts, including the first call. Default: 3. */
  attempts?: number;
  /** Return `false` to stop retrying, e.g. for validation errors or HTTP 4xx. Default: always retry. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each backoff; useful for logging and metrics. */
  onRetry?: (context: RetryContext) => void;
  /** Cancels the current backoff and any further attempts. */
  signal?: AbortSignal;
  /** Source of randomness for jitter. Injectable for deterministic tests. Default: `Math.random`. */
  random?: () => number;
}

/** Delay before the retry that follows `attempt` (1-based). Exported for testing and tuning. */
export function computeDelay(attempt: number, options: BackoffOptions, random: () => number = Math.random): number {
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * options.factor ** (attempt - 1));
  return options.jitter === 'full' ? Math.floor(random() * exponential) : exponential;
}

/**
 * Calls `operation` until it succeeds, the attempts are exhausted, `shouldRetry` declines,
 * or the signal is aborted. The last error is rethrown unchanged.
 */
export async function retry<T>(
  operation: (attempt: number, signal?: AbortSignal) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 100,
    maxDelayMs = 10_000,
    factor = 2,
    jitter = 'full',
    shouldRetry = () => true,
    onRetry,
    signal,
    random = Math.random,
  } = options;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('attempts must be a positive integer');
  }

  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await operation(attempt, signal);
    } catch (error) {
      if (attempt >= attempts || !shouldRetry(error, attempt)) throw error;

      const delayMs = computeDelay(attempt, { baseDelayMs, maxDelayMs, factor, jitter }, random);
      onRetry?.({ attempt, error, delayMs });
      await sleep(delayMs, signal);
    }
  }
}
