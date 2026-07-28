import {
  type AuthenticatedUser,
  type AuthSession,
  type LoginRequest,
  loginRequestSchema,
  type RegisterRequest,
  registerRequestSchema,
  ROUTES,
} from '@dice-game/contracts';
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CredentialsRateLimit } from '../common/decorators/rate-limit.decorator';
import { type RequestUser } from '../common/http/request-context';
import { ZodBody } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

/**
 * The four routes of `ROUTES.auth`, and nothing else.
 *
 * Two are `@Public()` — register and login, exactly the pair the contract's
 * `PUBLIC_ROUTES` allow-list names — and both carry `@CredentialsRateLimit()`,
 * which charges them to the far smaller `AUTH_RATE_LIMIT_*` budget. A limit
 * sized for a player clicking Roll is a limit sized for thousands of password
 * guesses an hour.
 *
 * The other two carry no decorator at all, which is the point of default-deny:
 * the global `JwtAuthGuard` protects them because nothing opted them out.
 *
 * **No handler here accepts an actor id.** Logout and `me` take `@CurrentUser()`,
 * which reads the identity the guard attached and throws if no guard ran. The
 * request bodies are the contract's `.strict()` schemas, so a body carrying
 * `userId` is a 400 rather than an impersonation.
 *
 * Handlers return payloads, not envelopes: `ResponseEnvelopeInterceptor` wraps
 * them in `{ data, meta }`.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * `POST /api/auth/register` — 201, and an immediate session.
   *
   * A duplicate email is `EMAIL_TAKEN` (409), raised by the store.
   */
  @Public()
  @CredentialsRateLimit()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an account', operationId: 'register' })
  register(@ZodBody(registerRequestSchema) body: RegisterRequest): Promise<AuthSession> {
    return this.auth.register(body);
  }

  /**
   * `POST /api/auth/login` — 200.
   *
   * 200 rather than 201: nothing was created. The failure is always
   * `INVALID_CREDENTIALS` (401) with one fixed message, whether the address is
   * unknown or the password is wrong.
   */
  @Public()
  @CredentialsRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for an access token', operationId: 'login' })
  login(@ZodBody(loginRequestSchema) body: LoginRequest): Promise<AuthSession> {
    return this.auth.login(body);
  }

  /**
   * `POST /api/auth/logout` — 204.
   *
   * Authenticated, and it acts on the *token holder*: there is no body and no id
   * parameter, so one user cannot log another out. Every token previously issued
   * to them stops verifying immediately.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke every access token for this user', operationId: 'logout' })
  logout(@CurrentUser() actor: RequestUser): Promise<void> {
    return this.auth.logout(actor);
  }

  /** `GET /api/auth/me` — the verified caller. Authenticated. */
  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'The authenticated user', operationId: 'me' })
  me(@CurrentUser() actor: RequestUser): AuthenticatedUser {
    return this.auth.me(actor);
  }
}

/**
 * The paths this controller must serve, as the contract names them. Combined
 * with the global `/api` prefix set in `main.ts`.
 */
export const AUTH_ROUTES = ROUTES.auth;
