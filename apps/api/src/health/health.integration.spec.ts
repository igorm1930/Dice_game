import 'reflect-metadata';

import { type Liveness, type Readiness, ROUTES } from '@dice-game/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createIntegrationApp, type IntegrationApp } from '../testing/integration-app';

/**
 * The probes, against the database they are probing.
 *
 * The Phase 3 stub reported `'up'` unconditionally, so readiness could not fail
 * and no test could tell whether it worked. The pair below is the whole point of
 * replacing it: readiness has to go *down* when MongoDB is unreachable, and
 * liveness has to stay *up* through the same outage. Conflating them turns a
 * database blip into a restart loop, which is strictly worse than the blip.
 *
 * `docker compose up -d` from the repository root must be running.
 */

let instance: IntegrationApp | null = null;

afterEach(async () => {
  await instance?.close();
  instance = null;
});

describe('readiness', () => {
  it('reports the database up while it is reachable', async () => {
    instance = await createIntegrationApp();

    const response = await instance.http.get(ROUTES.health.ready).expect(200);
    const readiness = response.body.data as Readiness;

    expect(readiness).toEqual({ status: 'ready', checks: { mongo: 'up' } });
  });

  /**
   * The failure the stub could never report.
   *
   * The connection is closed underneath a running application — the closest
   * thing to "the database went away" that does not involve stopping the
   * container — and the probe has to notice, answer 503, and name the dependency
   * rather than throwing a 500 that an orchestrator reads as a timeout.
   */
  it('reports the database down, with a 503, when the connection is gone', async () => {
    instance = await createIntegrationApp();

    await instance.mongo.connection.close();

    const response = await instance.http.get(ROUTES.health.ready).expect(503);
    const readiness = response.body.data as Readiness;

    expect(readiness).toEqual({ status: 'not_ready', checks: { mongo: 'down' } });
  });
});

describe('liveness', () => {
  it('touches nothing, and so survives an outage readiness reports', async () => {
    instance = await createIntegrationApp();

    await instance.mongo.connection.close();

    // Readiness is down; the process is still perfectly alive, and restarting it
    // would not bring MongoDB back.
    await instance.http.get(ROUTES.health.ready).expect(503);

    const response = await instance.http.get(ROUTES.health.live).expect(200);
    const liveness = response.body.data as Liveness;

    expect(liveness.status).toBe('ok');
    expect(liveness.uptime).toBeGreaterThan(0);
  });
});

describe('both probes', () => {
  it('are reachable without a token, as the contract publishes them', async () => {
    instance = await createIntegrationApp();

    await instance.http.get(ROUTES.health.live).expect(200);
    await instance.http.get(ROUTES.health.ready).expect(200);
  });
});
