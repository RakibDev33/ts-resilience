import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { TimeoutError, withTimeout } from '../src/index.js';

describe('withTimeout', () => {
  it('resolves when the operation finishes in time', async () => {
    await expect(withTimeout(async () => 'fast', 1_000)).resolves.toBe('fast');
  });

  it('rejects with TimeoutError and aborts the operation when the deadline passes', async () => {
    let received: AbortSignal | undefined;
    const neverSettles = (signal: AbortSignal) => {
      received = signal;
      return new Promise<string>(() => {});
    };

    const error = await withTimeout(neverSettles, 20).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(received?.aborted).toBe(true);
  });

  it('propagates cancellation from a parent signal', async () => {
    const parent = new AbortController();

    const result = withTimeout((signal) => delay(10_000, 'late', { signal }), 60_000, { signal: parent.signal });
    parent.abort(new Error('user navigated away'));

    await expect(result).rejects.toThrow('user navigated away');
  });

  it('rejects immediately if the parent signal is already aborted', async () => {
    const parent = new AbortController();
    parent.abort(new Error('too late'));

    await expect(withTimeout(async () => 'never', 1_000, { signal: parent.signal })).rejects.toThrow('too late');
  });
});
