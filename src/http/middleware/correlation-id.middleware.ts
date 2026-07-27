import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { requestContext } from '../../infrastructure/logging/request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Bounds what an untrusted client can inject into our log stream. */
const MAX_INBOUND_ID_LENGTH = 128;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id for this request. Always set by the middleware below. */
    requestId: string;
  }
}

/**
 * Establishes a correlation id for the request and binds it to the async
 * context so every subsequent log line carries it automatically.
 *
 * An inbound `x-request-id` is honoured so a trace can be followed across
 * service hops — but only after validation. Echoing an arbitrary client string
 * into logs and response headers is a log-injection and header-injection vector;
 * anything unexpected is replaced with a fresh UUID rather than sanitised.
 */
export function correlationIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.header(REQUEST_ID_HEADER);
    const requestId = isAcceptableId(inbound) ? inbound : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    requestContext.run({ requestId }, () => {
      next();
    });
  };
}

function isAcceptableId(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_INBOUND_ID_LENGTH &&
    SAFE_ID_PATTERN.test(value)
  );
}
