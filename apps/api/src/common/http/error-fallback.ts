import { Logger } from '@nestjs/common';
import { type ErrorRequestHandler } from 'express';

import { renderFailure } from '../filters/domain-exception.filter';
import { REQUEST_ID_HEADER } from '../middleware/correlation-id.middleware';
import { asAppRequest, resolveRequestId } from './request-context';

/**
 * The last line of the envelope guarantee.
 *
 * `DomainExceptionFilter` covers everything Nest routes — guards, pipes,
 * interceptors, handlers. It does not cover failures raised by Express-level
 * middleware, which report through `next(err)` rather than by throwing; the body
 * parser is the one that matters, because refusing an oversized body is a
 * *designed* outcome (`PAYLOAD_TOO_LARGE`) rather than an accident. Without this
 * handler that response would be Express's default HTML, and a client that
 * expects the envelope on every response would be wrong exactly when a user is
 * hitting a limit.
 *
 * Registered last, after `app.init()`, so it sits behind every route.
 */
export function errorEnvelopeFallback(): ErrorRequestHandler {
  const logger = new Logger('ErrorFallback');

  return (error: unknown, request, response, next): void => {
    const requestId = resolveRequestId(asAppRequest(request));
    const rendered = renderFailure(error, requestId);

    if (rendered.unexpected) {
      logger.error(
        `${rendered.body.error.code} (${String(rendered.status)}) [${requestId}]`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    if (response.headersSent) {
      next(error);

      return;
    }

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(rendered.status).json(rendered.body);
  };
}
