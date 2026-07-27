import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import pinoHttp from 'pino-http';

/**
 * Per-request access logging.
 *
 * Two choices worth noting:
 *  - the correlation id is reused as pino's request id rather than pino
 *    generating a second, competing one;
 *  - health probes are logged at `trace`. A Kubernetes liveness probe every
 *    second is 86,400 log lines a day that describe nothing, and they drown the
 *    lines that matter.
 */
export function httpLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req) => req.requestId ?? 'unknown',
    customLogLevel: (req, res, err) => {
      if (err ?? res.statusCode >= 500) {
        return 'error';
      }
      if (res.statusCode >= 400) {
        return 'warn';
      }
      if (req.url === '/healthz' || req.url === '/readyz') {
        return 'trace';
      }
      return 'info';
    },
    // `req.url` is rewritten relative to the router mount point, so a route
    // under /api/v1 would log as "/games". `originalUrl` keeps the full path,
    // without which log-based alerting cannot distinguish endpoints.
    customSuccessMessage: (req, res) =>
      `${req.method ?? 'UNKNOWN'} ${req.originalUrl ?? req.url ?? ''} ${res.statusCode}`,
    serializers: {
      req: (req: { method: string; url: string; originalUrl?: string }) => ({
        method: req.method,
        url: req.originalUrl ?? req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  }) as RequestHandler;
}
