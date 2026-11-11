/** Thrown by `withTimeout` when the deadline passes before the operation settles. */
export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/** Thrown by `CircuitBreaker.execute` while the circuit is open. */
export class CircuitOpenError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Circuit is open; retry after ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}
