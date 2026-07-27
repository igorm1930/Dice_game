import type { ErrorRequestHandler, Request, Response } from 'express';
import pino from 'pino';

import {
  ConcurrencyConflictError,
  GameAlreadyCompletedError,
  GameNotFoundError,
  InvalidRoundCountError,
  DomainError,
} from '../../src/core/domain/errors';
import { errorHandler } from '../../src/http/middleware/error-handler.middleware';
import { RequestValidationError } from '../../src/http/middleware/validate.middleware';

/**
 * The 500 path is the one that cannot be provoked through the public API — by
 * construction, no valid request triggers an internal error. It is also the
 * path where an information leak would live, so it is unit tested directly.
 */
interface CapturedResponse {
  status: number;
  body: unknown;
  headersSent: boolean;
  destroyed: boolean;
}

function invoke(
  handler: ErrorRequestHandler,
  error: unknown,
  options: { headersSent?: boolean } = {},
): CapturedResponse {
  const captured: CapturedResponse = {
    status: 0,
    body: undefined,
    headersSent: options.headersSent ?? false,
    destroyed: false,
  };

  const res = {
    get headersSent(): boolean {
      return captured.headersSent;
    },
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    destroy() {
      captured.destroyed = true;
    },
  } as unknown as Response;

  const req = {
    requestId: 'req-123',
    method: 'POST',
    originalUrl: '/api/v1/games',
  } as unknown as Request;

  handler(error, req, res, jest.fn());

  return captured;
}

describe('errorHandler', () => {
  const logger = pino({ level: 'silent' });
  const handler = errorHandler(logger);

  describe('domain error mapping', () => {
    it.each([
      [new GameNotFoundError('g1'), 404, 'GAME_NOT_FOUND'],
      [new GameAlreadyCompletedError('g1', 5), 409, 'GAME_ALREADY_COMPLETED'],
      [new ConcurrencyConflictError('g1', 1, 2), 409, 'CONCURRENCY_CONFLICT'],
      [new InvalidRoundCountError(99, 20), 422, 'INVALID_ROUND_COUNT'],
    ])('maps %s to the right status', (error, expectedStatus, expectedCode) => {
      const result = invoke(handler, error);

      expect(result.status).toBe(expectedStatus);
      expect(result.body).toMatchObject({ error: { code: expectedCode } });
    });

    it('falls back to 400 for an unmapped domain code', () => {
      class ExoticError extends DomainError {
        readonly code = 'SOMETHING_NEW';
        constructor() {
          super('An unmapped domain failure.');
        }
      }

      const result = invoke(handler, new ExoticError());

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: 'SOMETHING_NEW' } });
    });

    it('surfaces domain details for the client to act on', () => {
      const result = invoke(handler, new GameNotFoundError('g1'));

      expect(result.body).toMatchObject({ error: { details: { gameId: 'g1' } } });
    });
  });

  describe('validation errors', () => {
    it('returns 400 with the per-field issues', () => {
      const error = new RequestValidationError([
        { field: 'playerName', message: 'required', source: 'body' },
      ]);

      const result = invoke(handler, error);

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', details: [{ field: 'playerName' }] },
      });
    });
  });

  describe('unexpected errors', () => {
    it('returns an opaque 500 that leaks neither message nor stack', () => {
      const secret = new Error('connection string user=admin password=hunter2');

      const result = invoke(handler, secret);

      expect(result.status).toBe(500);
      const serialised = JSON.stringify(result.body);
      expect(serialised).not.toContain('hunter2');
      expect(serialised).not.toContain('password');
      expect(result.body).toMatchObject({
        error: { code: 'INTERNAL_SERVER_ERROR' },
      });
    });

    it('still returns the request id, which is the operator handle', () => {
      const result = invoke(handler, new Error('boom'));

      expect(result.body).toMatchObject({ meta: { requestId: 'req-123' } });
    });

    it('handles a thrown non-Error value without crashing', () => {
      const result = invoke(handler, 'a bare string');

      expect(result.status).toBe(500);
    });

    it('does not trust an arbitrary error carrying a 4xx status field', () => {
      // Only recognised body-parser error types may set the status; otherwise a
      // library error with an incidental `status` could downgrade a real bug.
      const rogue = Object.assign(new Error('nope'), { status: 403 });

      expect(invoke(handler, rogue).status).toBe(500);
    });
  });

  describe('body-parser errors', () => {
    it('maps malformed JSON to 400', () => {
      const parserError = Object.assign(new SyntaxError('Unexpected end of JSON'), {
        status: 400,
        type: 'entity.parse.failed',
      });

      const result = invoke(handler, parserError);

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: 'MALFORMED_REQUEST_BODY' } });
    });

    it('maps an oversized body to 413', () => {
      const parserError = Object.assign(new Error('request entity too large'), {
        status: 413,
        type: 'entity.too.large',
      });

      const result = invoke(handler, parserError);

      expect(result.status).toBe(413);
      expect(result.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    });
  });

  describe('when the response has already started', () => {
    it('aborts the connection instead of writing a second status line', () => {
      const result = invoke(handler, new Error('late failure'), { headersSent: true });

      expect(result.destroyed).toBe(true);
      expect(result.status).toBe(0);
      expect(result.body).toBeUndefined();
    });
  });
});
