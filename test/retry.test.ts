import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeDelay, retry } from '../src/index.js';

const noDelay = { baseDelayMs: 0, jitter: 'none' } as const;

describe('retry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the first successful result', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValue('ok');

    await expect(retry(operation, noDelay)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('rethrows the last error once attempts are exhausted', async () => {
    let calls = 0;
    const operation = async () => {
      calls++;
      throw new Error(`failure ${calls}`);
    };

    await expect(retry(operation, { ...noDelay, attempts: 3 })).rejects.toThrow('failure 3');
    expect(calls).toBe(3);
  });

  it('stops immediately when shouldRetry declines', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('400 Bad Request'));

    await expect(retry(operation, { ...noDelay, attempts: 5, shouldRetry: () => false })).rejects.toThrow('400');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('waits with exponential backoff between attempts', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('ok');

    const result = retry(operation, { baseDelayMs: 100, jitter: 'none', onRetry: ({ delayMs }) => delays.push(delayMs) });

    await vi.advanceTimersByTimeAsync(99);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe('ok');
    expect(delays).toEqual([100, 200]);
  });

  it('cancels a pending backoff when the signal aborts', async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(new Error('down'));

    const result = retry(operation, { baseDelayMs: 60_000, jitter: 'none', signal: controller.signal });
    controller.abort(new Error('cancelled by caller'));

    await expect(result).rejects.toThrow('cancelled by caller');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('validates the number of attempts', async () => {
    await expect(retry(async () => 'ok', { attempts: 0 })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('computeDelay', () => {
  const options = { baseDelayMs: 100, maxDelayMs: 1_000, factor: 2, jitter: 'none' } as const;

  it('grows exponentially and respects the cap', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => computeDelay(attempt, options))).toEqual([100, 200, 400, 800, 1_000]);
  });

  it('applies full jitter within [0, computed)', () => {
    expect(computeDelay(3, { ...options, jitter: 'full' }, () => 0.5)).toBe(200);
    expect(computeDelay(3, { ...options, jitter: 'full' }, () => 0)).toBe(0);
  });
});
