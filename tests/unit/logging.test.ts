import { Writable } from 'node:stream';

import { loadEnv } from '../../src/config/env';
import { createLogger } from '../../src/infrastructure/logging/logger';
import { requestContext } from '../../src/infrastructure/logging/request-context';

describe('requestContext', () => {
  it('returns undefined outside a request scope', () => {
    expect(requestContext.get()).toBeUndefined();
    expect(requestContext.getRequestId()).toBeUndefined();
  });

  it('exposes the id inside the scope', () => {
    requestContext.run({ requestId: 'abc' }, () => {
      expect(requestContext.getRequestId()).toBe('abc');
      expect(requestContext.get()).toEqual({ requestId: 'abc' });
    });
  });

  it('propagates across async boundaries', async () => {
    await requestContext.run({ requestId: 'async-1' }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(requestContext.getRequestId()).toBe('async-1');
    });
  });

  it('keeps concurrent scopes isolated', async () => {
    const observe = (id: string): Promise<string | undefined> =>
      requestContext.run({ requestId: id }, async () => {
        await new Promise((resolve) => setTimeout(resolve, id === 'slow' ? 20 : 1));
        return requestContext.getRequestId();
      });

    await expect(Promise.all([observe('slow'), observe('fast')])).resolves.toEqual([
      'slow',
      'fast',
    ]);
  });

  it('does not leak the scope after it exits', () => {
    requestContext.run({ requestId: 'temp' }, () => undefined);

    expect(requestContext.getRequestId()).toBeUndefined();
  });
});

describe('createLogger', () => {
  /** Captures the NDJSON pino actually emits, so assertions are on real output. */
  function captureLines(): { stream: Writable; lines: () => Record<string, unknown>[] } {
    const chunks: string[] = [];

    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback): void {
        chunks.push(chunk.toString());
        callback();
      },
    });

    return {
      stream,
      lines: () =>
        chunks
          .join('')
          .split('\n')
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  }

  it('honours the configured level', () => {
    const logger = createLogger(loadEnv({ LOG_LEVEL: 'warn' }));

    expect(logger.level).toBe('warn');
  });

  it('builds a pretty-printing logger when enabled', () => {
    const logger = createLogger(loadEnv({ LOG_PRETTY: 'true', LOG_LEVEL: 'silent' }));

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('emits the level as a readable label, not a number', () => {
    const { stream, lines } = captureLines();
    createLogger(loadEnv({ LOG_LEVEL: 'info' }), stream).info('hello');

    expect(lines()[0]).toMatchObject({ level: 'info', msg: 'hello' });
  });

  it('tags every line with the service name and environment', () => {
    const { stream, lines } = captureLines();
    createLogger(loadEnv({ SERVICE_NAME: 'dice', NODE_ENV: 'production' }), stream).info('x');

    expect(lines()[0]).toMatchObject({ service: 'dice', env: 'production' });
  });

  /**
   * The payoff of the AsyncLocalStorage mixin: no call site passes a request
   * id, yet every line carries one.
   */
  it('stamps the active request id onto lines without any call site passing it', () => {
    const { stream, lines } = captureLines();
    const logger = createLogger(loadEnv({ LOG_LEVEL: 'info' }), stream);

    requestContext.run({ requestId: 'mixin-1' }, () => {
      logger.info('inside a request');
    });
    logger.info('outside a request');

    expect(lines()[0]).toMatchObject({ requestId: 'mixin-1' });
    expect(lines()[1]).not.toHaveProperty('requestId');
  });

  it('redacts credentials so they never reach the log stream', () => {
    const { stream, lines } = captureLines();
    const logger = createLogger(loadEnv({ LOG_LEVEL: 'info' }), stream);

    logger.info(
      {
        password: 'hunter2',
        token: 'bearer-abc',
        req: { headers: { authorization: 'Bearer secret', cookie: 'session=xyz' } },
      },
      'sensitive',
    );

    const serialised = JSON.stringify(lines()[0]);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('bearer-abc');
    expect(serialised).not.toContain('Bearer secret');
    expect(serialised).not.toContain('session=xyz');
    expect(serialised).toContain('[REDACTED]');
  });

  it('writes ISO timestamps rather than epoch millis', () => {
    const { stream, lines } = captureLines();
    createLogger(loadEnv({ LOG_LEVEL: 'info' }), stream).info('t');

    expect(lines()[0]?.['time']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
