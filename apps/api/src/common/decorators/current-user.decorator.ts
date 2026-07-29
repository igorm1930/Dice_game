import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { asAppRequest, requireRequestUser, type RequestUser } from '../http/request-context';

/**
 * The verified caller, as attached by the authentication guard.
 *
 * ```ts
 * @Post()
 * create(@CurrentUser() actor: RequestUser) { ... }
 * ```
 *
 * **It throws when no guard ran.** It does not return `undefined`, and there is
 * no option to make it. A handler that receives an undefined identity and
 * proceeds is how an endpoint ends up acting on behalf of nobody in particular;
 * failing loudly turns that from a silent authorisation hole into a 500 and a
 * log line. The thrown `MissingRequestUserError` is not a contract error code,
 * so `DomainExceptionFilter` renders it as an opaque 500 — the client learns
 * nothing, the operator learns everything.
 *
 * Identity is *never* read from a request body. This decorator is the only way
 * a handler learns who is calling.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof RequestUser | undefined, context: ExecutionContext): unknown => {
    const user = requireRequestUser(asAppRequest(context.switchToHttp().getRequest()));

    return field === undefined ? user : user[field];
  },
);
