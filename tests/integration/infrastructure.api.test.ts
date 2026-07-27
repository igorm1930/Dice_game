import type { Express } from 'express';
import request from 'supertest';

import { createContainer, type Container } from '../../src/container';

function buildContainer(overrides: Partial<Container['env']> = {}): Container {
  return createContainer({
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      LOG_PRETTY: false,
      RATE_LIMIT_MAX: 10_000,
      ...overrides,
    },
  });
}

describe('Health probes', () => {
  let container: Container;
  let app: Express;

  beforeEach(() => {
    container = buildContainer();
    app = container.app;
  });

  it('reports liveness', async () => {
    const response = await request(app).get('/healthz').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', service: 'dice-game-service' });
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
  });

  it('reports readiness while serving', async () => {
    const response = await request(app).get('/readyz').expect(200);

    expect(response.body.status).toBe('ready');
  });

  /**
   * The behaviour that makes a rolling deploy lossless: readiness must fail
   * before the server stops accepting connections, so the load balancer drains
   * this instance while it can still serve in-flight work.
   */
  it('fails readiness once draining, while liveness still passes', async () => {
    container.setReady(false);

    const ready = await request(app).get('/readyz').expect(503);
    expect(ready.body.status).toBe('draining');

    await request(app).get('/healthz').expect(200);
  });
});

describe('Cross-cutting HTTP concerns', () => {
  let app: Express;

  beforeEach(() => {
    app = buildContainer().app;
  });

  describe('correlation id', () => {
    it('generates one and echoes it in the header and body', async () => {
      const response = await request(app).get('/api/v1/games').expect(200);

      expect(response.headers['x-request-id']).toEqual(expect.any(String));
      expect(response.body.meta.requestId).toBe(response.headers['x-request-id']);
    });

    it('propagates a well-formed inbound id for cross-service tracing', async () => {
      const response = await request(app)
        .get('/api/v1/games')
        .set('x-request-id', 'trace-abc-123')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('trace-abc-123');
    });

    /**
     * A forged id is a log-injection vector: an attacker who can write
     * `" level="fatal` into a value we emit as NDJSON can forge log records.
     * Anything outside the safe charset is replaced with a fresh UUID rather
     * than escaped — rejecting is simpler to get right than sanitising.
     *
     * (A literal newline cannot be tested through an HTTP client, which rejects
     * it at the socket layer. The quote-and-space payload below is header-legal
     * and reaches our middleware, which is the code under test.)
     */
    it('replaces a hostile inbound id rather than echoing it', async () => {
      const injection = 'bad id" level="fatal';

      const response = await request(app)
        .get('/api/v1/games')
        .set('x-request-id', injection)
        .expect(200);

      expect(response.headers['x-request-id']).not.toBe(injection);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.body.meta.requestId).not.toContain('level=');
    });

    it('rejects an over-long inbound id', async () => {
      const response = await request(app).get('/api/v1/games').set('x-request-id', 'a'.repeat(200));

      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('includes the id on error responses too', async () => {
      const response = await request(app).get('/api/v1/nope').expect(404);

      expect(response.body.meta.requestId).toBe(response.headers['x-request-id']);
    });
  });

  describe('security headers', () => {
    it('applies helmet defaults', async () => {
      const response = await request(app).get('/api/v1/games');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
    });

    it('does not advertise the framework', async () => {
      const response = await request(app).get('/api/v1/games');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('error envelope', () => {
    it('returns a structured 404 for an unknown route', async () => {
      const response = await request(app).get('/does/not/exist').expect(404);

      expect(response.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
      expect(response.body.error.message).toContain('/does/not/exist');
    });

    it('returns 404 for a known path with the wrong method', async () => {
      await request(app).delete('/api/v1/games').expect(404);
    });

    it('rejects an oversized body with 413', async () => {
      const app413 = buildContainer({ BODY_LIMIT: '100b' }).app;

      const response = await request(app413)
        .post('/api/v1/games')
        .send({ playerName: 'x'.repeat(500) })
        .expect(413);

      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('never exposes a stack trace', async () => {
      const response = await request(app).get('/api/v1/games/not-a-uuid').expect(400);

      expect(JSON.stringify(response.body)).not.toMatch(/at .*\.ts:\d+/);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 with the standard envelope once the window is exhausted', async () => {
      const limited = buildContainer({ RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_MS: 60_000 }).app;

      await request(limited).get('/api/v1/games').expect(200);
      await request(limited).get('/api/v1/games').expect(200);

      const response = await request(limited).get('/api/v1/games').expect(429);

      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.meta.requestId).toEqual(expect.any(String));
    });

    it('advertises the limit via draft-7 headers', async () => {
      const limited = buildContainer({ RATE_LIMIT_MAX: 5 }).app;

      const response = await request(limited).get('/api/v1/games');

      expect(response.headers['ratelimit-limit'] ?? response.headers.ratelimit).toBeDefined();
    });

    /**
     * A throttled probe causes the orchestrator to restart a service that is
     * merely busy — turning a load spike into an outage.
     */
    it('never throttles health probes', async () => {
      const limited = buildContainer({ RATE_LIMIT_MAX: 1 }).app;

      await request(limited).get('/api/v1/games').expect(200);
      await request(limited).get('/api/v1/games').expect(429);

      for (let i = 0; i < 10; i += 1) {
        await request(limited).get('/healthz').expect(200);
        await request(limited).get('/readyz').expect(200);
      }
    });
  });

  describe('container isolation', () => {
    it('gives each container its own repository state', async () => {
      const first = buildContainer().app;
      const second = buildContainer().app;

      await request(first).post('/api/v1/games').send({ playerName: 'Ada' }).expect(201);

      const response = await request(second).get('/api/v1/games').expect(200);
      expect(response.body.data.pagination.total).toBe(0);
    });
  });
});
