import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';

export interface ValidationSchemas {
  readonly body?: ZodTypeAny;
  readonly params?: ZodTypeAny;
  readonly query?: ZodTypeAny;
}

/**
 * Validation failure raised by the middleware below.
 *
 * Kept in the HTTP layer rather than the domain: a malformed JSON body is a
 * transport concern, and the domain should never learn that HTTP exists.
 */
export class RequestValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super('The request payload failed validation.');
    this.name = 'RequestValidationError';
    this.issues = issues;
  }
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
  readonly source: 'body' | 'params' | 'query';
}

/**
 * Validates and — importantly — *replaces* the request parts with the parsed
 * output, so downstream handlers receive coerced, typed, defaulted values
 * rather than the raw `string | string[] | undefined` Express hands over.
 *
 * Parsed values are attached to `req.validated` instead of overwriting
 * `req.query`, which is a getter-only property in Express 5 and on some Node
 * versions; assigning to it works today and breaks on upgrade.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const issues: ValidationIssue[] = [];
    const validated: Record<string, unknown> = {};

    for (const source of ['body', 'params', 'query'] as const) {
      const schema = schemas[source];
      if (!schema) {
        continue;
      }

      const result = schema.safeParse(req[source]);

      if (result.success) {
        validated[source] = result.data;
      } else {
        issues.push(...toIssues(result.error, source));
      }
    }

    if (issues.length > 0) {
      next(new RequestValidationError(issues));
      return;
    }

    req.validated = validated;
    next();
  };
}

function toIssues(error: ZodError, source: ValidationIssue['source']): ValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
    source,
  }));
}

/**
 * Type-safe accessor for validated request data.
 *
 * Casting is confined to this single function: the `validate` middleware is the
 * only writer, so if a route calls this for a part it did not validate the
 * result is `undefined` and fails fast, rather than silently typed as valid.
 */
export function validated<T>(req: Request, source: 'body' | 'params' | 'query'): T {
  const value = req.validated?.[source];

  if (value === undefined) {
    throw new Error(
      `No validated '${source}' on this request. ` +
        `Add a '${source}' schema to the validate() middleware for this route.`,
    );
  }

  return value as T;
}

export interface ValidatedRequestData {
  body?: unknown;
  params?: unknown;
  query?: unknown;
}

declare module 'express-serve-static-core' {
  interface Request {
    validated?: ValidatedRequestData;
  }
}
