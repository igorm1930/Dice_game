import { type ApiSuccess } from '@dice-game/contracts';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, map } from 'rxjs';

import { asAppRequest, resolveRequestId } from '../http/request-context';

/**
 * Wraps every successful payload in the contract's success envelope:
 * `{ data, meta: { requestId } }`, matching `apiSuccess()`.
 *
 * Handlers therefore return payloads — a `GameView`, a `UserSummary[]` — and
 * never the envelope itself. One implementation of the wrapper means a client
 * never has to guess the shape from the status code, and `meta.requestId`
 * arrives on success as well as failure, so a user can quote an id for a
 * response that was merely *wrong* rather than an error.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requestId = resolveRequestId(asAppRequest(context.switchToHttp().getRequest()));

    return next.handle().pipe(
      map((payload: unknown): unknown => {
        // A handler that built its own envelope is passed through untouched
        // rather than nested inside a second one.
        if (isEnveloped(payload)) {
          return payload;
        }

        const envelope: ApiSuccess<unknown> = {
          // `undefined` would vanish from the JSON, leaving `data` absent
          // rather than empty; the contract always carries the key.
          data: payload ?? null,
          meta: { requestId },
        };

        return envelope;
      }),
    );
  }
}

function isEnveloped(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }

  if (!Object.hasOwn(payload, 'data') || !Object.hasOwn(payload, 'meta')) {
    return false;
  }

  const meta: unknown = (payload as { meta: unknown }).meta;

  return (
    typeof meta === 'object' &&
    meta !== null &&
    typeof (meta as { requestId?: unknown }).requestId === 'string'
  );
}
