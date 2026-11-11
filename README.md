# ts-resilience

![CI](https://github.com/RakibDev33/ts-resilience/actions/workflows/ci.yml/badge.svg)

Zero-dependency resilience primitives for TypeScript and Node.js:

- **`retry`**: exponential backoff with full jitter, retry classification and cancellation
- **`withTimeout`**: deadlines that actually cancel the underlying work through `AbortSignal`
- **`CircuitBreaker`**: closed / open / half-open breaker that fails fast while a dependency is down

Written in strict TypeScript, ships as ESM with type declarations, and is fully unit tested with deterministic clocks and fake timers.

## Usage

Compose the primitives from the inside out: a timeout per attempt, retries around it, and the breaker on the outside so that one exhausted retry sequence counts as one failure.

```ts
import { CircuitBreaker, CircuitOpenError, retry, withTimeout } from 'ts-resilience';

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  // 4xx responses mean the service is up, so they should not trip the breaker
  isFailure: (error) => !(error instanceof HttpError && error.status < 500),
});

export function getUser(id: string) {
  return breaker.execute(() =>
    retry(
      () =>
        withTimeout(async (signal) => {
          const response = await fetch(`https://api.example.com/users/${id}`, { signal });
          if (!response.ok) throw new HttpError(response.status);
          return response.json();
        }, 2_000),
      {
        attempts: 3,
        baseDelayMs: 200,
        shouldRetry: (error) => !(error instanceof HttpError && error.status < 500),
      },
    ),
  );
}

try {
  await getUser('42');
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.warn(`User service unavailable, retry in ${error.retryAfterMs}ms`);
  }
}
```

## API

### `retry(operation, options?)`

Calls `operation(attempt, signal)` until it succeeds. The last error is rethrown unchanged.

| Option        | Default        | Description                                                   |
| ------------- | -------------- | ------------------------------------------------------------- |
| `attempts`    | `3`            | Total attempts, including the first call                      |
| `baseDelayMs` | `100`          | Delay before the first retry                                  |
| `maxDelayMs`  | `10000`        | Cap for any single delay                                      |
| `factor`      | `2`            | Exponential growth factor                                     |
| `jitter`      | `'full'`       | `'full'` = random in `[0, delay)`, `'none'` = deterministic   |
| `shouldRetry` | always         | `(error, attempt) => boolean`, return `false` to stop         |
| `onRetry`     | none           | `({ attempt, error, delayMs }) => void`, for logs and metrics |
| `signal`      | none           | `AbortSignal` that cancels the backoff and further attempts   |

### `withTimeout(operation, timeoutMs, { signal }?)`

Runs `operation(signal)` and rejects with `TimeoutError` if it does not settle within `timeoutMs`. The signal passed to the operation is aborted on timeout or when the optional parent signal aborts, so `fetch` and other cancellable APIs stop doing work.

### `new CircuitBreaker(options?)`

| Option             | Default    | Description                                                   |
| ------------------ | ---------- | ------------------------------------------------------------- |
| `failureThreshold` | `5`        | Consecutive failures that open the circuit                    |
| `resetTimeoutMs`   | `30000`    | Time in the open state before one trial call is allowed       |
| `isFailure`        | all errors | Classify errors; non-failures reset the failure count         |
| `onStateChange`    | none       | `(from, to) => void`, for logging and alerting                |
| `now`              | `Date.now` | Injectable clock                                              |

`breaker.execute(fn)` runs `fn` or throws `CircuitOpenError` (with `retryAfterMs`) while the circuit is open. `breaker.state` returns `'closed' | 'open' | 'half-open'`.

## Design notes

- **Full jitter.** Delays are drawn uniformly from `[0, min(maxDelay, base * factor^n))`. Randomising the whole interval spreads retries from many clients and avoids synchronized retry storms better than adding a small random offset.
- **Cancellation is first-class.** Every primitive accepts or provides an `AbortSignal`. A timeout that only stops waiting but leaves the request running wastes sockets and can apply writes after the caller has given up.
- **Errors are classified, not just counted.** Both `retry` (`shouldRetry`) and the breaker (`isFailure`) let callers distinguish "the dependency is unhealthy" from "this request is invalid".
- **Deterministic tests.** Time and randomness are injectable, and the test suite uses Vitest fake timers instead of real sleeps.

## Development

```bash
npm install
npm test           # run the unit tests
npm run typecheck  # strict type checking
npm run build      # emit dist/ with .d.ts files
```

## License

MIT
