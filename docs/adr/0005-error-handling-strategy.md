# ADR-0005: Transport-agnostic domain errors with centralised HTTP mapping

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Error handling determines two things a reviewer can judge immediately: whether
a client can program against the API, and whether an operator can debug it.

The common anti-pattern is a domain error that knows its HTTP status:

```ts
// Rejected
class GameNotFoundError extends Error {
  statusCode = 404;
}
```

This couples the domain to HTTP. The same core can then never be driven by a
queue consumer, a CLI, or a gRPC service without dragging a meaningless
`statusCode` along, and status decisions end up scattered across dozens of files.

## Decision

### Domain errors carry a code, never a status

```ts
export class GameNotFoundError extends DomainError {
  readonly code = 'GAME_NOT_FOUND';
}
```

`DomainError` also carries a frozen `details` object with machine-readable
context (which game, which version, which limit).

### One table maps codes to statuses

In `src/http/middleware/error-handler.middleware.ts`:

| Code                     | Status | Meaning                                 |
| ------------------------ | ------ | --------------------------------------- |
| `VALIDATION_ERROR`       | 400    | Payload failed schema validation        |
| `MALFORMED_REQUEST_BODY` | 400    | Body was not valid JSON                 |
| `GAME_NOT_FOUND`         | 404    | No such game                            |
| `ROUTE_NOT_FOUND`        | 404    | No such endpoint                        |
| `GAME_ALREADY_COMPLETED` | 409    | All rounds already played               |
| `CONCURRENCY_CONFLICT`   | 409    | Write against a stale snapshot          |
| `PAYLOAD_TOO_LARGE`      | 413    | Body exceeded the limit                 |
| `INVALID_ROUND_COUNT`    | 422    | Well-formed, but violates a domain rule |
| `RATE_LIMIT_EXCEEDED`    | 429    | Too many requests                       |
| `INTERNAL_SERVER_ERROR`  | 500    | A bug                                   |

The 400/422 split is deliberate and worth stating: **400** means "this payload is
malformed"; **422** means "this payload is well-formed but the domain rejects
it". `{"rounds": "abc"}` is a 400; `{"rounds": 50}` against a limit of 20 is a 422. An unmapped domain code falls back to 400 rather than 500 — a new domain
rule is a client error by default, not a server fault.

### 4xx and 5xx are treated as different categories

**4xx are expected.** A client asked for something it could not have. Logged at
`warn` with the message only — attaching a stack trace to every 404 buries real
incidents. The client gets the full message and details, so it can fix the call.

**5xx are bugs.** Logged at `error` with the full stack and request context. The
client gets an opaque message and a request id:

```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected error occurred. Quote the request id when reporting this."
  },
  "meta": { "requestId": "0b7c…", "timestamp": "2026-07-27T09:40:49.393Z" }
}
```

Leaking an internal message is an information disclosure — stack traces reveal
paths, versions, and sometimes credentials from connection strings. It is also
useless to the caller. The request id is what actually resolves the issue, and
it correlates to every log line for that request (ADR-0006).

### Controllers do not catch

No `try/catch` in any controller. Errors propagate to the single terminal
handler. Per-controller catch blocks are duplicated policy that inevitably
drifts, and they are how a 404 becomes a 500 in one endpoint but not another.

## Consequences

**Positive**

- The core is portable to any transport.
- Every status decision is in one greppable file.
- Clients branch on stable `code` strings, never on message text.
- A user-reported failure is traceable from a single id.
- 5xx alerting is meaningful because 4xx does not pollute it.

**Negative**

- A new domain error needs an entry in the mapping table, or it silently
  defaults to 400. Mitigated by the fallback being a sane default and by the
  error-handler test suite covering every mapped code.

## Verification

`tests/unit/error-handler.test.ts` asserts every mapping, the unmapped-code
fallback, that a 500 leaks neither message nor stack, that an arbitrary error
carrying a `status` field cannot downgrade a 500, and that a failure after
headers are sent aborts the connection rather than corrupting the response.
