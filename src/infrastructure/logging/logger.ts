import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { Env } from '../../config/env';
import { requestContext } from './request-context';

export type { Logger };

/**
 * Structured logger.
 *
 * Production emits NDJSON to stdout and nothing else: no files, no rotation, no
 * transports. The container runtime owns log shipping (12-factor XI), and a
 * process that writes its own log files is a process that fills a disk.
 *
 * Every line is automatically stamped with the active request id via
 * AsyncLocalStorage, so a single grep reconstructs the full story of one
 * request across every layer.
 */
/**
 * @param destination Optional sink. Production leaves this unset so pino writes
 *   NDJSON to stdout. Supplying an in-memory stream lets the test suite assert
 *   on the bytes actually emitted — including that redaction really fires —
 *   rather than reaching into pino's internals.
 */
export function createLogger(env: Env, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: {
      service: env.SERVICE_NAME,
      env: env.NODE_ENV,
    },
    formatters: {
      // Emit `"level":"info"` rather than `"level":30` — human-greppable and
      // what every log backend expects by default.
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin: () => {
      const requestId = requestContext.getRequestId();
      return requestId ? { requestId } : {};
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        'password',
        '*.password',
        'token',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
  };

  if (destination) {
    return pino(options, destination);
  }

  if (env.LOG_PRETTY) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(options);
}
