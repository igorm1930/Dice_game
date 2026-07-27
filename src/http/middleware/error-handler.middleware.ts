import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';

import { DomainError } from '../../core/domain/errors';
import type { ErrorResponse } from '../dto/api-response';
import { RequestValidationError } from './validate.middleware';

/**
 * The single place where a domain concept becomes an HTTP status.
 *
 * Domain errors carry a `code` and no status. Keeping this table here means the
 * core stays transport-agnostic, and every status decision in the service is
 * greppable in one file instead of scattered across controllers.
 */
const DOMAIN_CODE_TO_STATUS: Readonly<Record<string, number>> = {
  GAME_NOT_FOUND: 404,
  GAME_ALREADY_COMPLETED: 409,
  PIG_GAME_OVER: 409,
  CONCURRENCY_CONFLICT: 409,
  INVALID_ROUND_COUNT: 422,
  INVALID_TARGET_SCORE: 422,
};

const DEFAULT_DOMAIN_STATUS = 400;

interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

/**
 * Terminal error middleware.
 *
 * Contract:
 *  - 4xx are *expected* outcomes. Logged at `warn`, and the client is told
 *    exactly what to fix.
 *  - 5xx are bugs. Logged at `error` with the full stack, and the client gets
 *    an opaque message plus the request id. Leaking an internal message or
 *    stack trace to a caller is an information disclosure, and it is also
 *    useless to them — the request id is what actually gets the issue fixed.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (rawError, req, res, _next) => {
    // Express types the error parameter as `any`. Narrowing to `unknown` at the
    // boundary forces every downstream branch to prove what it is holding.
    const error: unknown = rawError;

    const requestId = req.requestId ?? 'unknown';
    const meta = { requestId, timestamp: new Date().toISOString() };

    // Response already streaming: we cannot rewrite the status line. Delegate to
    // Express's default handler, which destroys the socket.
    if (res.headersSent) {
      logger.error(
        { err: error, requestId },
        'Error raised after response headers were sent; aborting connection.',
      );
      res.destroy();
      return;
    }

    const resolved = resolve(error);

    const logContext = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: resolved.status,
      errorCode: resolved.body.code,
    };

    if (resolved.status >= 500) {
      // A 5xx is a bug: log everything, stack included.
      logger.error({ ...logContext, err: error }, 'Unhandled error while processing request.');
    } else {
      // A 4xx is an expected outcome — a client asked for something it could not
      // have. Attaching a stack trace to each one buries genuine incidents in
      // noise, so only the message survives.
      logger.warn(
        { ...logContext, reason: error instanceof Error ? error.message : String(error) },
        'Request rejected.',
      );
    }

    const payload: ErrorResponse = { error: resolved.body, meta };
    res.status(resolved.status).json(payload);
  };
}

interface ResolvedError {
  readonly status: number;
  readonly body: ErrorResponse['error'];
}

function resolve(error: unknown): ResolvedError {
  if (error instanceof RequestValidationError) {
    return {
      status: 400,
      body: { code: error.code, message: error.message, details: error.issues },
    };
  }

  if (error instanceof DomainError) {
    return {
      status: DOMAIN_CODE_TO_STATUS[error.code] ?? DEFAULT_DOMAIN_STATUS,
      body: { code: error.code, message: error.message, details: error.details },
    };
  }

  // body-parser surfaces malformed JSON and oversized payloads as tagged Errors
  // with a status. Without this branch they become a misleading 500.
  const parserStatus = bodyParserStatus(error);
  if (parserStatus !== null) {
    return {
      status: parserStatus,
      body: {
        code: parserStatus === 413 ? 'PAYLOAD_TOO_LARGE' : 'MALFORMED_REQUEST_BODY',
        message:
          parserStatus === 413
            ? 'Request body exceeds the maximum permitted size.'
            : 'Request body could not be parsed as JSON.',
      },
    };
  }

  return {
    status: 500,
    body: {
      code: 'INTERNAL_SERVER_ERROR',
      // Deliberately opaque. The request id in `meta` is the operator's handle.
      message: 'An unexpected error occurred. Quote the request id when reporting this.',
    },
  };
}

function bodyParserStatus(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const candidate = error as BodyParserError;
  const status = candidate.status ?? candidate.statusCode;

  if (typeof status !== 'number' || status < 400 || status >= 500) {
    return null;
  }

  // Only trust the status for errors we recognise as parser output.
  const isParserError =
    typeof candidate.type === 'string' &&
    ['entity.parse.failed', 'entity.too.large', 'encoding.unsupported', 'request.aborted'].includes(
      candidate.type,
    );

  return isParserError ? status : null;
}

/**
 * Catch-all for unmatched routes. Registered last, before the error handler, so
 * an unknown path produces the same envelope as every other failure instead of
 * Express's HTML default.
 */
export function notFoundHandler(): RequestHandler {
  return (req, res) => {
    const payload: ErrorResponse = {
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `No route matches ${req.method} ${req.originalUrl}.`,
      },
      meta: {
        requestId: req.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    res.status(404).json(payload);
  };
}
