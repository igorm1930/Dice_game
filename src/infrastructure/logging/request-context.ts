import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Ambient per-request context propagated via AsyncLocalStorage.
 *
 * This is the one place a global is the right answer. The alternative —
 * threading a correlation id through every service and repository signature —
 * pollutes domain interfaces with a transport concern purely for logging.
 * ALS keeps the correlation id available to any log call in the async tree
 * without it appearing in a single business signature.
 */
export const requestContext = {
  run<T>(context: RequestContext, callback: () => T): T {
    return storage.run(context, callback);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
