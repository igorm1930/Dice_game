import { z } from 'zod';

import { errorCodeSchema } from './errors.js';

/**
 * Every response — success or failure — carries the same envelope, so a client
 * never has to guess the shape from the status code.
 */

export const responseMetaSchema = z.object({
  /** Echoes `x-request-id`; the value to quote in a bug report. */
  requestId: z.string(),
});

export type ResponseMeta = z.infer<typeof responseMetaSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  /**
   * Structured context — which field failed, which revision was expected.
   * Never contains a credential, a hash, or a stack trace.
   */
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiFailureSchema = z.object({
  error: apiErrorSchema,
  meta: responseMetaSchema,
});

export type ApiFailure = z.infer<typeof apiFailureSchema>;

/** Wraps a payload schema in the success envelope. */
export function apiSuccess<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: responseMetaSchema });
}

export interface ApiSuccess<T> {
  data: T;
  meta: ResponseMeta;
}

/** Wraps a payload schema in the paginated success envelope. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  });
}

export const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
