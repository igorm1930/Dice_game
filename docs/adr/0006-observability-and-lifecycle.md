# ADR-0006: Structured logging, correlation ids, and graceful shutdown

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

A service is production-ready when an operator can answer "what happened to this
request?" and when a deploy does not drop traffic. Both are design decisions, not
features to add later.

## Decision

### Structured NDJSON to stdout, and nothing else

Pino, one JSON object per line, written to stdout. No log files, no rotation, no
transports in production.

This is 12-factor XII: the process is not responsible for log routing. A process
that writes its own files is a process that can fill a disk, and its logs are
invisible to `kubectl logs` and to every container log collector.

`pino-pretty` is available for local development and is **off by default**
(`LOG_PRETTY=false`). Human-readable output in production is unparseable by the
tools that consume it.

Configured deliberately:

- **Level as a label** (`"level":"info"`, not `"level":30`) — greppable, and the
  default expectation of every log backend.
- **ISO timestamps**, not epoch millis.
- **Redaction** of `authorization`, `cookie`, `x-api-key`, `set-cookie`,
  `password`, and `token` at any depth. A credential in a log is a credential in
  every downstream system that ingests logs, potentially for years.
- **Health probes logged at `trace`.** A liveness probe every second is 86,400
  lines a day describing nothing.

### Correlation ids via AsyncLocalStorage

Every request gets an id — reused from a validated inbound `x-request-id`, or
freshly generated. It is returned in the response header **and** in every
response body's `meta` block, so a user reporting a failure hands over one
string that pins the exact request.

The id is bound to `AsyncLocalStorage` and injected into every log line by a
pino `mixin`. This is the one place a global is the right answer: the
alternative — threading a correlation id through every service and repository
signature — pollutes domain interfaces with a transport concern purely for
logging. With ALS, the id appears on every line and in zero business signatures.

**Inbound ids are validated, not trusted.** Anything outside
`[A-Za-z0-9_.:-]{1,128}` is replaced with a fresh UUID. Echoing an arbitrary
client string into an NDJSON log stream is log injection: a value containing
`" level="fatal` could forge log records. Rejecting is simpler to get right than
escaping.

### Liveness and readiness are separate endpoints

| Endpoint   | Question                       | Depends on  |
| ---------- | ------------------------------ | ----------- |
| `/healthz` | Is this process wedged?        | Nothing     |
| `/readyz`  | Should traffic route here now? | Drain state |

Liveness must **not** check downstream dependencies. If it did, a dependency
outage would fail liveness on every replica, the orchestrator would restart them
all, and a partial degradation would become a total outage.

Readiness flips to 503 the instant SIGTERM arrives. Collapsing these two into one
endpoint is the most common cause of dropped requests during a rolling deploy.

### Graceful shutdown, in a specific order

On SIGTERM (`src/server.ts`):

1. **Fail readiness first.** The load balancer stops routing new traffic while
   the process is still able to serve what is already queued. Closing the server
   first would reject requests the balancer has not yet learned to stop sending
   — this ordering is what makes a rolling deploy lossless.
2. **Stop accepting connections**, then let in-flight requests finish.
3. **Force exit after `SHUTDOWN_TIMEOUT_MS`** (default 10s). A hung keep-alive
   connection must never prevent exit, or the orchestrator SIGKILLs the process
   anyway — with no log line explaining why.

A repeated signal during drain is ignored rather than restarting the sequence.

`keepAliveTimeout` (65s) is set above the typical load-balancer idle timeout
(60s). If Node closed a connection first, the balancer could dispatch onto a
socket being closed — the classic source of sporadic 502s behind ALB and nginx.

`uncaughtException` and `unhandledRejection` both log at `fatal` and trigger the
same drain with a non-zero exit. A process in an undefined state cannot safely
continue; the correct response is to die cleanly and let the orchestrator replace
it.

### Express 4 requires explicit async error bridging

Express 4 does not await handler return values, so a rejected promise from a bare
`async` handler never reaches the error middleware: the request hangs until it
times out and the process logs an unhandled rejection. Every async route is
wrapped in `asyncHandler`, and an architecture test enforces that no route
escapes it.

Express 5 handles this natively — at which point `asyncHandler` is deleted, not
rewritten.

## Consequences

**Positive**

- Any request is fully reconstructable from one id.
- Logs are queryable without parsing rules.
- Rolling deploys drop no requests.
- Credentials cannot reach the log stream.

**Negative**

- ALS carries a small overhead (single-digit percent on hot paths). Overwhelmingly
  worth it for the traceability.
- No metrics endpoint. Deliberate: without a Prometheus scraper to consume it,
  `/metrics` is code nobody reads. It is the obvious next addition once a
  monitoring stack exists.

## Verification

`tests/unit/logging.test.ts` asserts on real emitted NDJSON — level labels,
service tagging, ISO timestamps, automatic request-id stamping, and that
credentials are actually redacted. `tests/integration/infrastructure.api.test.ts`
covers id propagation, hostile-id rejection, and that readiness fails while
liveness passes during drain.
