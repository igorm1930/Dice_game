import { apiSuccess, gameViewSchema, livenessSchema } from '@dice-game/contracts';
import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { type AppRequest, setRequestId } from '../http/request-context';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

function intercept(payload: unknown, requestId?: string): Promise<unknown> {
  const request = { headers: {} } as unknown as AppRequest;

  if (requestId !== undefined) {
    setRequestId(request, requestId);
  }

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  const handler: CallHandler = { handle: () => of(payload) };

  return firstValueFrom(new ResponseEnvelopeInterceptor().intercept(context, handler));
}

describe('wrapping a payload', () => {
  it('produces exactly the shape apiSuccess describes', async () => {
    const liveness = { status: 'ok', uptime: 12.5, version: '2.0.0' };
    const enveloped = await intercept(liveness, 'req-1');

    expect(enveloped).toEqual({ data: liveness, meta: { requestId: 'req-1' } });
    expect(apiSuccess(livenessSchema).safeParse(enveloped).success).toBe(true);
  });

  it('wraps an array without flattening it into the envelope', async () => {
    expect(await intercept([{ id: 'a' }, { id: 'b' }], 'req-2')).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      meta: { requestId: 'req-2' },
    });
  });

  it('keeps a handler returning nothing well-formed', async () => {
    // `undefined` would disappear from the JSON, leaving `data` absent rather
    // than empty, and a client destructuring `{ data }` would see a key that
    // sometimes does not exist.
    expect(await intercept(undefined, 'req-3')).toEqual({
      data: null,
      meta: { requestId: 'req-3' },
    });
    expect(await intercept(null, 'req-4')).toEqual({ data: null, meta: { requestId: 'req-4' } });
  });

  it('preserves falsy payloads that are not absent', async () => {
    expect(await intercept(0, 'req-5')).toEqual({ data: 0, meta: { requestId: 'req-5' } });
    expect(await intercept(false, 'req-6')).toEqual({ data: false, meta: { requestId: 'req-6' } });
    expect(await intercept('', 'req-7')).toEqual({ data: '', meta: { requestId: 'req-7' } });
  });
});

describe('the request id', () => {
  it('comes from the correlation middleware', async () => {
    const enveloped = (await intercept({ ok: true }, 'inbound-id')) as {
      meta: { requestId: string };
    };

    expect(enveloped.meta.requestId).toBe('inbound-id');
  });

  it('is minted rather than omitted when no middleware ran', async () => {
    const enveloped = (await intercept({ ok: true })) as { meta: { requestId: string } };

    expect(enveloped.meta.requestId).toMatch(/^[\da-f-]{36}$/);
  });
});

describe('an envelope the handler built itself', () => {
  it('is passed through rather than nested inside a second one', async () => {
    const already = { data: { id: 'x' }, meta: { requestId: 'handler-made' } };

    expect(await intercept(already, 'req-8')).toBe(already);
  });

  it('still wraps an ordinary payload that merely has a data field', async () => {
    const payload = { data: 'not an envelope' };

    expect(await intercept(payload, 'req-9')).toEqual({
      data: payload,
      meta: { requestId: 'req-9' },
    });
  });
});

describe('agreement with the contract', () => {
  it('validates against apiSuccess for a real game view', async () => {
    const gameView = {
      id: '507f1f77bcf86cd799439011',
      players: [
        { userId: '507f1f77bcf86cd799439011', displayName: 'Ada', globalScore: 40, winCount: 2 },
        { userId: '507f1f77bcf86cd799439012', displayName: 'Grace', globalScore: 35, winCount: 1 },
      ],
      activePlayer: 0,
      roundScore: 12,
      lastDice: [6, 6],
      winningScore: 100,
      ruleset: { id: 'standard', version: 1 },
      gameNumber: 4,
      status: 'ACTIVE',
      winner: null,
      revision: 17,
      availableActions: { canRoll: true, canHold: true, canStartNewGame: true },
      effect: 'DOUBLE_SIX',
      viewerSeat: 0,
      createdAt: '2026-07-28T10:00:00.000Z',
      updatedAt: '2026-07-28T10:05:00.000Z',
    };

    const enveloped = await intercept(gameView, 'req-10');

    expect(apiSuccess(gameViewSchema).safeParse(enveloped).success).toBe(true);
  });
});
