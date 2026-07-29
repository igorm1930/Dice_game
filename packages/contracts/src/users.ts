import { z } from 'zod';

import { displayNameSchema, idSchema } from './primitives.js';

/**
 * The opponent picker's data source, and nothing more.
 *
 * Deliberately narrower than the user record: no email, no timestamps, no
 * counts. The endpoint requires authentication and is paginated, because an
 * open, unbounded user list is an enumeration endpoint however innocuous the
 * fields look.
 */
export const userSummarySchema = z.object({
  id: idSchema,
  displayName: displayNameSchema,
});

export type UserSummary = z.infer<typeof userSummarySchema>;
