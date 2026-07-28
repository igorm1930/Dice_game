import {
  type ApiFailure,
  ERROR_STATUS,
  type ErrorCode,
  type ResponseMeta,
} from '@dice-game/contracts';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';

import { DomainError } from '../../domain/errors';
import { ApiError } from '../errors/api-error';
import { asAppRequest, asResponse, resolveRequestId } from '../http/request-context';
import { REQUEST_ID_HEADER } from '../middleware/correlation-id.middleware';

/**
 * The one place an error becomes an HTTP response.
 *
 * The rule this file exists to enforce: **a `DomainError` carries a stable
 * `code` and never an HTTP status.** The status is looked up in `ERROR_STATUS`
 * from `@dice-game/contracts` — the single table both sides of the wire read.
 * It is imported, never re-declared; the previous generation kept the mapping in
 * an ADR *and* in a middleware and the two had already drifted four codes apart.
 *
 * Three properties are deliberate and each is asserted by a test:
 *
 *  - **A 500 cannot be downgraded.** The status is derived only from a
 *    recognised error *type* — `ApiError`, `DomainError`, `HttpException` — and
 *    never by reading a `status` or `statusCode` property off an arbitrary
 *    object. An unknown throw carrying `{ status: 400 }` is still a 500, because
 *    otherwise any object flowing through a `catch` could dictate the response.
 *  - **Nothing leaks.** An unrecognised error renders a fixed message and no
 *    details. Stack traces, hashes, connection strings and driver messages stay
 *    server-side, in the log, next to the request id.
 *  - **Framework exceptions do not invent codes.** A Nest `HttpException` maps
 *    only for statuses that have an unambiguous contract code. Anything else —
 *    a bare `ForbiddenException` from a guard that returned `false`, say — is a
 *    delivery-layer bug and is reported as an opaque 500 and logged loudly.
 *    Throw an {@link ApiError} with an explicit code instead.
 */

/**
 * The codes a framework-raised failure is allowed to become. `Extract` rather
 * than a hand-written union, so a code renamed in the contract fails to compile
 * here rather than drifting.
 */
type FallbackCode = Extract<
  ErrorCode,
  | 'MALFORMED_REQUEST_BODY'
  | 'UNAUTHENTICATED'
  | 'ROUTE_NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMIT_EXCEEDED'
>;

/**
 * Statuses a framework exception may be rendered as, and the contract code each
 * one means. Deliberately partial: a status with no unambiguous code is a bug,
 * not a response.
 */
const HTTP_STATUS_FALLBACK: Readonly<Record<number, FallbackCode>> = Object.freeze({
  400: 'MALFORMED_REQUEST_BODY',
  401: 'UNAUTHENTICATED',
  404: 'ROUTE_NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMIT_EXCEEDED',
});

/**
 * Messages for framework-raised failures.
 *
 * Fixed strings rather than `exception.message`: Nest's 404 message quotes the
 * requested path back at the caller, and reflecting attacker-controlled text
 * into a response body is a habit worth not having, however benign it looks in
 * JSON.
 */
const FALLBACK_MESSAGE: Readonly<Record<FallbackCode, string>> = Object.freeze({
  MALFORMED_REQUEST_BODY: 'The request body could not be parsed.',
  UNAUTHENTICATED: 'Authentication is required for this endpoint.',
  ROUTE_NOT_FOUND: 'No route matches this request.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  RATE_LIMIT_EXCEEDED: 'Too many requests. Wait a moment and try again.',
});

export const OPAQUE_ERROR_MESSAGE = 'An unexpected error occurred.';

/** A failure ready to be written: a status and the contract envelope. */
export interface RenderedFailure {
  readonly status: number;
  readonly body: ApiFailure;
  /** True when the cause was not something this API meant to produce. */
  readonly unexpected: boolean;
}

/**
 * The status for a code, or `null` when the code is not in the contract.
 *
 * `Object.hasOwn` rather than a truthiness check: a code of `'toString'`
 * arriving from a rogue error object must not resolve through the prototype.
 */
function statusForCode(code: string): number | null {
  if (!Object.hasOwn(ERROR_STATUS, code)) {
    return null;
  }

  return (ERROR_STATUS as Readonly<Record<string, number>>)[code] ?? null;
}

function failure(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Readonly<Record<string, unknown>>,
  unexpected = false,
): RenderedFailure {
  const meta: ResponseMeta = { requestId };
  const body: ApiFailure =
    details === undefined || Object.keys(details).length === 0
      ? { error: { code, message }, meta }
      : { error: { code, message, details }, meta };

  return { status: statusForCode(code) ?? 500, body, unexpected };
}

function opaqueFailure(requestId: string): RenderedFailure {
  return failure('INTERNAL_SERVER_ERROR', OPAQUE_ERROR_MESSAGE, requestId, undefined, true);
}

/**
 * `body-parser` reports its refusals through `http-errors`, which sets a `type`
 * discriminator. Matching on that — rather than on the `status` property that
 * happens to sit beside it — is what keeps this from being the generic
 * "trust any object with a status" hole the filter otherwise refuses.
 */
function bodyParserCode(exception: unknown): FallbackCode | null {
  if (!(exception instanceof Error)) {
    return null;
  }

  const type: unknown = (exception as { type?: unknown }).type;

  if (type === 'entity.too.large') {
    return 'PAYLOAD_TOO_LARGE';
  }

  if (type === 'entity.parse.failed' || type === 'charset.unsupported') {
    return 'MALFORMED_REQUEST_BODY';
  }

  return null;
}

/**
 * Maps any thrown value to a status and a contract envelope. Pure, so the
 * mapping can be tested without an HTTP server.
 */
export function renderFailure(exception: unknown, requestId: string): RenderedFailure {
  if (exception instanceof ApiError) {
    return failure(exception.code, exception.message, requestId, exception.details);
  }

  if (exception instanceof DomainError) {
    const status = statusForCode(exception.code);

    // A domain code the contract does not know is a drift bug, not a client
    // error. `src/rules-contract-agreement.test.ts` fails the build first.
    return status === null
      ? opaqueFailure(requestId)
      : failure(exception.code as ErrorCode, exception.message, requestId, exception.details);
  }

  const parserCode = bodyParserCode(exception);

  if (parserCode !== null) {
    return failure(parserCode, FALLBACK_MESSAGE[parserCode], requestId);
  }

  if (exception instanceof HttpException) {
    const code = HTTP_STATUS_FALLBACK[exception.getStatus()];

    return code === undefined
      ? opaqueFailure(requestId)
      : failure(code, FALLBACK_MESSAGE[code], requestId);
  }

  return opaqueFailure(requestId);
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType<string>() !== 'http') {
      throw exception;
    }

    const http = host.switchToHttp();
    const request = asAppRequest(http.getRequest());
    const response = asResponse(http.getResponse());
    const requestId = resolveRequestId(request);
    const rendered = renderFailure(exception, requestId);

    this.report(exception, rendered, requestId);

    if (response.headersSent) {
      return;
    }

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(rendered.status).json(rendered.body);
  }

  /**
   * Everything the response withholds goes here instead. The request id is the
   * join key between the two.
   */
  private report(exception: unknown, rendered: RenderedFailure, requestId: string): void {
    const summary = `${rendered.body.error.code} (${String(rendered.status)}) [${requestId}]`;

    if (rendered.unexpected || rendered.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(summary, stack ?? String(exception));

      return;
    }

    this.logger.debug(summary);
  }
}
