import { type ErrorCode, ERROR_STATUS } from '@dice-game/contracts';
import { vi } from 'vitest';

/**
 * A hand-written API, not a mocking framework.
 *
 * The repository's testing convention is explicit test doubles — the API suite
 * has no `vi.mock()` calls anywhere and is better for it. This is the same idea
 * at the network boundary: a `fetch` that routes on paths from the contract's
 * own `ROUTES` table, answers in the contract's envelopes, and derives its
 * status codes from the contract's `ERROR_STATUS` map.
 *
 * That last point matters. If a test asserts "a 409 revision conflict makes the
 * client refetch", the 409 came from the same table the API maps its errors
 * with, so the test cannot drift away from the server's behaviour.
 *
 * Every request is recorded, which is how the two-seats-two-tokens property is
 * asserted: the tests check the `Authorization` header each individual request
 * carried, not that "a token" was sent.
 */

export interface RecordedRequest {
  method: string;
  path: string;
  /** The bearer token this specific request carried, or `null` if it carried none. */
  token: string | null;
  body: unknown;
}

export interface FakeResponse {
  status: number;
  body: unknown;
}

/** Async so a test can hold a response open and assert the pending state. */
export type FakeHandler = (request: RecordedRequest) => FakeResponse | Promise<FakeResponse>;

export const REQUEST_ID = 'test-request-id';

/** A success envelope, exactly as `ResponseEnvelopeInterceptor` builds one. */
export function ok(data: unknown, status = 200): FakeResponse {
  return { status, body: { data, meta: { requestId: REQUEST_ID } } };
}

export function noContent(): FakeResponse {
  return { status: 204, body: null };
}

/**
 * A failure envelope. The status comes from the contract's single
 * code-to-status table rather than from a number typed here.
 */
export function fail(code: ErrorCode, message = `Failed with ${code}`): FakeResponse {
  return {
    status: ERROR_STATUS[code],
    body: { error: { code, message }, meta: { requestId: REQUEST_ID } },
  };
}

export interface FakeApi {
  /** Every request the client made, in order. */
  readonly requests: readonly RecordedRequest[];
  /** Registers a handler. Registering the same route again replaces it. */
  route: (method: 'GET' | 'POST', path: string, handler: FakeHandler) => void;
  /** Requests made to one path, for asserting a refetch happened. */
  callsTo: (method: 'GET' | 'POST', path: string) => readonly RecordedRequest[];
}

/** A promise a test resolves by hand, to hold a request open. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

function toResponse({ status, body }: FakeResponse): Response {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-request-id': REQUEST_ID,
  });

  if (status === 204) {
    return new Response(null, { status, headers });
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function tokenOf(headers: Headers): string | null {
  const authorization = headers.get('Authorization');
  const prefix = 'Bearer ';

  if (authorization?.startsWith(prefix) !== true) {
    return null;
  }

  return authorization.slice(prefix.length);
}

/** Installs the fake as `globalThis.fetch`. `unstubGlobals` restores it after each test. */
export function installFakeApi(): FakeApi {
  const handlers = new Map<string, FakeHandler>();
  const requests: RecordedRequest[] = [];
  const key = (method: string, path: string): string => `${method} ${path}`;

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const rawBody = init?.body;

    const request: RecordedRequest = {
      method,
      path: url.pathname,
      token: tokenOf(headers),
      body: typeof rawBody === 'string' ? (JSON.parse(rawBody) as unknown) : undefined,
    };

    requests.push(request);

    const handler = handlers.get(key(method, url.pathname));

    if (handler === undefined) {
      return toResponse(fail('ROUTE_NOT_FOUND', `No fake handler for ${method} ${url.pathname}`));
    }

    return toResponse(await handler(request));
  };

  vi.stubGlobal('fetch', fakeFetch);

  return {
    requests,
    route: (method, path, handler) => {
      handlers.set(key(method, path), handler);
    },
    callsTo: (method, path) =>
      requests.filter((request) => request.method === method && request.path === path),
  };
}
