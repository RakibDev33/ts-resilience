import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError, type CircuitBreakerOptions } from '../src/index.js';

const fail = () => Promise.reject(new Error('boom'));
const succeed = () => Promise.resolve('ok');

function createBreaker(overrides: Partial<CircuitBreakerOptions> = {}) {
  let time = 0;
  const transitions: string[] = [];
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 1_000,
    now: () => time,
    onStateChange: (from, to) => transitions.push(`${from}->${to}`),
    ...overrides,
  });
  const trip = async () => {
    for (let i = 0; i < 3; i++) await breaker.execute(fail).catch(() => undefined);
  };
  return { breaker, transitions, trip, advance: (ms: number) => (time += ms) };
}

describe('CircuitBreaker', () => {
  it('opens after consecutive failures and then fails fast', async () => {
    const { breaker, trip } = createBreaker();
    await trip();

    expect(breaker.state).toBe('open');
    await expect(breaker.execute(succeed)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('resets the failure count after a success', async () => {
    const { breaker } = createBreaker();
    await breaker.execute(fail).catch(() => undefined);
    await breaker.execute(fail).catch(() => undefined);
    await breaker.execute(succeed);
    await breaker.execute(fail).catch(() => undefined);

    expect(breaker.state).toBe('closed');
  });

  it('allows a trial call after the reset timeout and closes on success', async () => {
    const { breaker, transitions, trip, advance } = createBreaker();
    await trip();

    advance(1_000);
    expect(breaker.state).toBe('half-open');
    await expect(breaker.execute(succeed)).resolves.toBe('ok');

    expect(breaker.state).toBe('closed');
    expect(transitions).toEqual(['closed->open', 'open->half-open', 'half-open->closed']);
  });

  it('re-opens immediately when the trial call fails', async () => {
    const { breaker, trip, advance } = createBreaker();
    await trip();
    advance(1_000);

    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.state).toBe('open');
  });

  it('lets only one trial call through while half-open', async () => {
    const { breaker, trip, advance } = createBreaker();
    await trip();
    advance(1_000);

    let release!: () => void;
    const trial = breaker.execute(() => new Promise<void>((resolve) => (release = resolve)));
    await expect(breaker.execute(succeed)).rejects.toBeInstanceOf(CircuitOpenError);

    release();
    await trial;
    expect(breaker.state).toBe('closed');
  });

  it('does not count errors that are classified as non-failures', async () => {
    const { breaker } = createBreaker({ isFailure: (error) => !(error instanceof RangeError) });

    for (let i = 0; i < 5; i++) {
      await breaker.execute(() => Promise.reject(new RangeError('invalid input'))).catch(() => undefined);
    }

    expect(breaker.state).toBe('closed');
  });

  it('reports how long callers should wait while open', async () => {
    const { breaker, trip, advance } = createBreaker();
    await trip();
    advance(400);

    const error = await breaker.execute(succeed).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CircuitOpenError);
    expect((error as CircuitOpenError).retryAfterMs).toBe(600);
  });
});
