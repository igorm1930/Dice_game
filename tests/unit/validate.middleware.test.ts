import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import {
  RequestValidationError,
  validate,
  validated,
} from '../../src/http/middleware/validate.middleware';

function run(
  handler: ReturnType<typeof validate>,
  req: Partial<Request>,
): { req: Request; error: unknown } {
  const request = req as Request;
  let captured: unknown;

  const next: NextFunction = (error?: unknown) => {
    captured = error;
  };

  handler(request, {} as Response, next);

  return { req: request, error: captured };
}

describe('validate', () => {
  const bodySchema = z.object({ name: z.string().min(1) }).strict();
  const querySchema = z.object({ limit: z.coerce.number().int().default(10) }).strict();

  it('stores parsed output rather than the raw input', () => {
    const { req, error } = run(validate({ query: querySchema }), { query: { limit: '25' } });

    expect(error).toBeUndefined();
    // Coercion is the point: handlers receive a number, not the string Express gave us.
    expect(validated<{ limit: number }>(req, 'query')).toEqual({ limit: 25 });
  });

  it('applies schema defaults for absent values', () => {
    const { req } = run(validate({ query: querySchema }), { query: {} });

    expect(validated<{ limit: number }>(req, 'query')).toEqual({ limit: 10 });
  });

  it('does not overwrite req.query, which is read-only in newer Express', () => {
    const original = { limit: '25' };
    const { req } = run(validate({ query: querySchema }), { query: original });

    expect(req.query).toBe(original);
  });

  it('passes a RequestValidationError to next on failure', () => {
    const { error } = run(validate({ body: bodySchema }), { body: { name: '' } });

    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as RequestValidationError).issues).toEqual([
      { field: 'name', message: expect.any(String), source: 'body' },
    ]);
  });

  it('reports issues from every source in a single response', () => {
    const { error } = run(validate({ body: bodySchema, query: querySchema }), {
      body: {},
      query: { limit: 'abc' },
    });

    const sources = (error as RequestValidationError).issues.map((issue) => issue.source);
    expect(new Set(sources)).toEqual(new Set(['body', 'query']));
  });

  it('rejects unknown fields so a typo is not silently ignored', () => {
    const { error } = run(validate({ body: bodySchema }), {
      body: { name: 'ok', isAdmin: true },
    });

    expect(error).toBeInstanceOf(RequestValidationError);
  });

  it('labels a root-level failure rather than emitting an empty field name', () => {
    const { error } = run(validate({ body: z.string() }), { body: 42 });

    expect((error as RequestValidationError).issues[0]?.field).toBe('(root)');
  });

  it('leaves unvalidated sources absent', () => {
    const { req } = run(validate({ body: bodySchema }), { body: { name: 'ok' }, query: {} });

    expect(req.validated?.query).toBeUndefined();
  });
});

describe('validated', () => {
  it('throws a developer-facing error when the source was never validated', () => {
    // Guards against a route that reads `params` but only declared a `body`
    // schema — a silent `undefined` there would surface as a confusing 500.
    expect(() => validated({} as Request, 'body')).toThrow(
      /Add a 'body' schema to the validate\(\) middleware/,
    );
  });
});
