import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Response } from 'express';

import { type AppRequest, setRequestId } from '../http/request-context';

/** The header carried in and echoed back out. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * The only shape of inbound correlation id this API will adopt.
 *
 * Bounded, and restricted to characters that cannot break a log line or a log
 * record: no whitespace, no newlines, no quotes, no control characters. An
 * inbound `x-request-id` is attacker-controlled and ends up in structured logs,
 * so a value containing `\n{"level":"info","msg":"..."}` would let a caller
 * forge log entries — log injection is the reason this is an allow-list rather
 * than a length check.
 *
 * Anything that does not match is not sanitised, not truncated, not escaped —
 * it is discarded and replaced with a generated UUID.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Whether a header value may be adopted as this request's correlation id. */
export function isAcceptableRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/**
 * Gives every request an id, and every response the same id back.
 *
 * The id is what the envelope reports as `meta.requestId` and what a user quotes
 * in a bug report, which is why it is minted here — before any guard, handler or
 * filter runs — rather than wherever it first happens to be needed.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: AppRequest, response: Response, next: NextFunction): void {
    const inbound: unknown = request.headers[REQUEST_ID_HEADER];
    const requestId = isAcceptableRequestId(inbound) ? inbound : randomUUID();

    setRequestId(request, requestId);
    response.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
