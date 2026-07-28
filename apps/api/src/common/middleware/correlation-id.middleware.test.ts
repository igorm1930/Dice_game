import { type Response } from 'express';
import { describe, expect, it } from 'vitest';

import { type AppRequest, resolveRequestId } from '../http/request-context';
import {
  CorrelationIdMiddleware,
  isAcceptableRequestId,
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
} from './correlation-id.middleware';

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

function run(inbound?: unknown): { requestId: string; header: unknown; nextCalls: number } {
  const request = { headers: { [REQUEST_ID_HEADER]: inbound } } as unknown as AppRequest;
  const headers: Record<string, unknown> = {};
  const response = {
    setHeader(name: string, value: unknown): void {
      headers[name] = value;
    },
  } as unknown as Response;

  let nextCalls = 0;

  new CorrelationIdMiddleware().use(request, response, () => {
    nextCalls += 1;
  });

  return { requestId: resolveRequestId(request), header: headers[REQUEST_ID_HEADER], nextCalls };
}

describe('adopting an inbound id', () => {
  it('accepts the shapes a well-behaved client sends', () => {
    for (const candidate of [
      'a',
      'req-1',
      '018f2c9e-5b0a-7c3d-8e4f-0a1b2c3d4e5f',
      'trace:abc.def_1-2',
      'A'.repeat(128),
    ]) {
      expect(isAcceptableRequestId(candidate), candidate).toBe(true);
      expect(run(candidate).requestId, candidate).toBe(candidate);
    }
  });

  it('echoes the adopted id back on the response', () => {
    expect(run('req-echo').header).toBe('req-echo');
  });
});

describe('rejecting an inbound id', () => {
  /**
   * The header is attacker-controlled and ends up in structured logs. A value
   * containing a newline lets a caller forge log records; a value containing
   * quotes or braces lets it corrupt an NDJSON line. None of these are
   * sanitised — they are discarded and replaced.
   */
  const hostile: readonly (readonly [string, string])[] = [
    ['newline', 'abc\ndef'],
    ['carriage return', 'abc\r\ndef'],
    ['forged log record', 'x\n{"level":"info","msg":"admin logged in"}'],
    ['space', 'two words'],
    ['tab', 'a\tb'],
    ['null byte', 'abc\u0000def'],
    ['ansi escape', '\u001b[31mred'],
    ['quote', 'he said "hi"'],
    ['comma-joined duplicates', 'first, second'],
    ['slash', 'a/b'],
    ['percent', '%73'],
    ['non-ascii letter', 'identité'],
    ['empty', ''],
    ['too long', 'a'.repeat(129)],
  ];

  it.each(hostile)('replaces a %s with a generated UUID', (_label, candidate) => {
    expect(isAcceptableRequestId(candidate)).toBe(false);

    const { requestId, header } = run(candidate);

    expect(requestId).not.toBe(candidate);
    expect(requestId).toMatch(UUID_PATTERN);
    expect(header).toBe(requestId);
  });

  it('rejects anything that is not a string', () => {
    for (const candidate of [undefined, null, 42, ['a', 'b'], { toString: () => 'a' }]) {
      expect(isAcceptableRequestId(candidate)).toBe(false);
    }

    // Express hands over an array when a header arrives more than once.
    expect(run(['first', 'second']).requestId).toMatch(UUID_PATTERN);
  });

  it('generates an id when no header is sent at all', () => {
    const { requestId, header } = run(undefined);

    expect(requestId).toMatch(UUID_PATTERN);
    expect(header).toBe(requestId);
  });
});

describe('the generated id', () => {
  it('satisfies the same pattern inbound ids must satisfy', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(run(undefined).requestId).toMatch(REQUEST_ID_PATTERN);
    }
  });

  it('differs between requests', () => {
    const ids = new Set(Array.from({ length: 50 }, () => run(undefined).requestId));

    expect(ids.size).toBe(50);
  });
});

describe('the middleware chain', () => {
  it('always continues, exactly once', () => {
    expect(run('valid-id').nextCalls).toBe(1);
    expect(run('in valid').nextCalls).toBe(1);
    expect(run(undefined).nextCalls).toBe(1);
  });
});
