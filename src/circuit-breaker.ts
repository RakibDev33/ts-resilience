import { CircuitOpenError } from './errors.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the circuit. Default: 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before a trial call is allowed. Default: 30s. */
  resetTimeoutMs?: number;
  /**
   * Classifies errors. Return `false` for errors that prove the dependency is healthy
   * (validation errors, 404s, ...); those reset the failure count instead of increasing it.
   */
  isFailure?: (error: unknown) => boolean;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  /** Clock, injectable for deterministic tests. Default: `Date.now`. */
  now?: () => number;
}

/**
 * Three-state circuit breaker.
 *
 * - closed:    calls pass through; consecutive failures are counted.
 * - open:      calls fail fast with `CircuitOpenError` until `resetTimeoutMs` has elapsed.
 * - half-open: exactly one trial call is let through; success closes the circuit,
 *              failure opens it again.
 */
export class CircuitBreaker {
  private currentState: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private trialInFlight = false;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly isFailure: (error: unknown) => boolean;
  private readonly onStateChange: ((from: CircuitState, to: CircuitState) => void) | undefined;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.isFailure = options.isFailure ?? (() => true);
    this.onStateChange = options.onStateChange;
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    if (this.currentState === 'open' && this.now() - this.openedAt >= this.resetTimeoutMs) {
      this.transition('half-open');
    }
    return this.currentState;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open' || (state === 'half-open' && this.trialInFlight)) {
      throw new CircuitOpenError(Math.max(0, this.resetTimeoutMs - (this.now() - this.openedAt)));
    }

    const isTrial = state === 'half-open';
    if (isTrial) this.trialInFlight = true;

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      if (this.isFailure(error)) this.recordFailure();
      else this.recordSuccess();
      throw error;
    } finally {
      if (isTrial) this.trialInFlight = false;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.transition('closed');
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    const shouldOpen = this.currentState === 'half-open' || this.consecutiveFailures >= this.failureThreshold;
    if (shouldOpen && this.currentState !== 'open') {
      this.openedAt = this.now();
      this.transition('open');
    }
  }

  private transition(to: CircuitState): void {
    const from = this.currentState;
    if (from === to) return;
    this.currentState = to;
    this.onStateChange?.(from, to);
  }
}
