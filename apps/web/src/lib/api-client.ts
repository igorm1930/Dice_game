import { apiFailureSchema, apiSuccess, type ErrorCode, REFETCH_ON } from '@dice-game/contracts';
import { type z } from 'zod';

import { API_BASE_URL } from './env';

/**
 * A thin typed `fetch`, and nothing more.
 *
 * Every response — success or failure — is parsed through a schema from
 * `@dice-game/contracts` before it reaches a component. That is the point: the
 * client cannot quietly render a field the API stopped sending, because the
 * parse fails first and the failure is visible. No response shape is declared
 * in this app.
 */

/**
 * Where a failure came from.
 *
 *  - `api` — the server answered in the contract's failure envelope. `code` is
 *    the server's own code and is the thing worth showing a user.
 *  - `transport` — `fetch` itself rejected: the API is down, DNS failed, CORS
 *    refused the request. No response existed.
 *  - `contract` — a response arrived that the contract cannot parse. That is a
 *    bug on one side of the wire, not a user error.
 *
 * The last two still carry an `ErrorCode` so callers have one field to switch
 * on; `INTERNAL_SERVER_ERROR` is the honest code for "something is broken and
 * it is not the caller's fault".
 */
export type ApiErrorKind = 'api' | 'transport' | 'contract';

export interface ApiErrorInit {
  kind: ApiErrorKind;
  code: ErrorCode;
  message: string;
  status: number;
  requestId: string | null;
  details?: unknown;
}

/** Every failure this module throws. Components never see a bare `Response`. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly code: ErrorCode;
  /** HTTP status, or 0 when the request never produced a response. */
  readonly status: number;
  /** The value to quote in a bug report; `null` when no response arrived. */
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

/**
 * Whether this failure should be answered by refetching rather than by showing
 * the user an error.
 *
 * The list is the contract's `REFETCH_ON`, not one written here. A revision
 * conflict is the *normal* consequence of two seats sharing one page: the other
 * seat moved the game on, so this seat's view is stale. So is acting when the
 * turn has already passed, or after the game has been won. None of those is a
 * failure the player did anything about — the answer is a fresh view.
 */
export function isRefetchable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'api' && REFETCH_ON.includes(error.code);
}

interface RequestInitOptions {
  path: string;
  method?: 'GET' | 'POST';
  /** The seat's access token. Never a shared "current user" token. */
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

interface ParsedRequestOptions<TSchema extends z.ZodTypeAny> extends RequestInitOptions {
  /** The contract schema for the payload inside the success envelope. */
  schema: TSchema;
}

const HTTP_NO_CONTENT = 204;

function buildHeaders(options: RequestInitOptions): Headers {
  const headers = new Headers({ Accept: 'application/json' });

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  // The token travels in an `Authorization` header rather than a cookie, and
  // that is forced by the assignment: two identities share one origin on one
  // page, and a cookie session can only represent one of them. See the comment
  // in `session-storage.ts` for the trade-off that follows.
  if (options.token != null && options.token !== '') {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  return headers;
}

async function send(options: RequestInitOptions): Promise<Response> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers: buildHeaders(options),
  };

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  try {
    return await fetch(`${API_BASE_URL}${options.path}`, init);
  } catch (cause) {
    throw new ApiError({
      kind: 'transport',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not reach the server. Check that the API is running.',
      status: 0,
      requestId: null,
      details: cause,
    });
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Turns any non-2xx response into an `ApiError`, preferring the server's code. */
function failureFrom(response: Response, payload: unknown): ApiError {
  const requestId = response.headers.get('x-request-id');
  const parsed = apiFailureSchema.safeParse(payload);

  if (parsed.success) {
    return new ApiError({
      kind: 'api',
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      status: response.status,
      requestId: parsed.data.meta.requestId,
      details: parsed.data.error.details,
    });
  }

  return new ApiError({
    kind: 'contract',
    code: 'INTERNAL_SERVER_ERROR',
    message: `The server answered ${response.status} in a shape the contract does not describe.`,
    status: response.status,
    requestId,
  });
}

/**
 * Performs a request and returns the payload inside the success envelope,
 * parsed through `schema`.
 *
 * @throws {ApiError} for any failure at all — transport, HTTP, or a response
 * the contract cannot parse.
 */
export async function apiRequest<TSchema extends z.ZodTypeAny>(
  options: ParsedRequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const response = await send(options);
  const payload = await readBody(response);

  if (!response.ok) {
    throw failureFrom(response, payload);
  }

  const parsed = apiSuccess(options.schema).safeParse(payload);

  if (!parsed.success) {
    throw new ApiError({
      kind: 'contract',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The server sent a response the contract does not describe.',
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      details: parsed.error.issues,
    });
  }

  // The parse above is the real check. `apiSuccess` is generic over the payload
  // schema, but the object type it infers loses the link between the two, so
  // this assertion only restates what the parse has already proved.
  const envelope: unknown = parsed.data;
  const { data } = envelope as { data: z.infer<TSchema> };

  return data;
}

/**
 * A request whose success carries no payload — `POST /api/auth/logout`, which
 * answers 204.
 *
 * @throws {ApiError} on any failure.
 */
export async function apiRequestNoContent(options: RequestInitOptions): Promise<void> {
  const response = await send(options);

  if (!response.ok) {
    throw failureFrom(response, await readBody(response));
  }

  if (response.status !== HTTP_NO_CONTENT) {
    throw new ApiError({
      kind: 'contract',
      code: 'INTERNAL_SERVER_ERROR',
      message: `Expected an empty response, got ${response.status}.`,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    });
  }
}
