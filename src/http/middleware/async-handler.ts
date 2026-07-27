import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Bridges async handlers into Express 4's synchronous error propagation.
 *
 * Express 4 does not await handler return values. A rejected promise from a
 * bare `async (req, res) => {...}` handler therefore never reaches the error
 * middleware — the client's request hangs until it times out, and the process
 * logs an unhandled rejection. This wrapper is mandatory on every async route.
 *
 * (Express 5 handles this natively. Documented in ADR-0006 as the reason the
 * upgrade is a one-line removal rather than a rewrite.)
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
