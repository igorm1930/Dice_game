/**
 * Stable response envelope.
 *
 * Every response — success or failure — carries a `meta` block with the
 * correlation id, so a user reporting "it broke" can hand over one string that
 * pins the exact request in the logs.
 */
export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string;
}

export interface SuccessResponse<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
}

export interface ErrorBody {
  /** Stable, machine-readable. Clients branch on this, never on the message. */
  readonly code: string;
  /** Human-readable and safe to display. Never contains internal detail. */
  readonly message: string;
  readonly details?: unknown;
}

export interface ErrorResponse {
  readonly error: ErrorBody;
  readonly meta: ResponseMeta;
}

export interface PaginatedData<T> {
  readonly items: readonly T[];
  readonly pagination: {
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
    readonly hasMore: boolean;
  };
}
