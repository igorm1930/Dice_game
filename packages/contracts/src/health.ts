import { z } from 'zod';

/**
 * Liveness and readiness are separate probes answering separate questions.
 *
 * `/live` — is the process running? Never touches a dependency, so a database
 * blip cannot get the container killed and restarted into the same blip.
 *
 * `/ready` — should this instance receive traffic? Checks MongoDB, and fails
 * first during a SIGTERM drain so the load balancer stops sending work before
 * the server stops accepting it. This is the Fly health check.
 */

export const livenessSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number().nonnegative(),
  version: z.string(),
});

export type Liveness = z.infer<typeof livenessSchema>;

export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    mongo: z.enum(['up', 'down']),
  }),
});

export type Readiness = z.infer<typeof readinessSchema>;
