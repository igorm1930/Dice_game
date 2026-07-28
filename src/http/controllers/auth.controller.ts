import type { Request, Response } from 'express';

import { toPlayerIdentity } from '../../core/domain/user';
import type { AuthService, AuthenticatedSession } from '../../core/services/auth.service';
import type { SuccessResponse } from '../dto/api-response';
import type { CredentialsBody, PlayerResponse, SessionResponse } from '../dto/auth.dto';
import { toPlayerResponse } from '../mappers/pig-game.mapper';
import { currentUser } from '../middleware/authenticate.middleware';
import { validated } from '../middleware/validate.middleware';

/**
 * HTTP adapter for authentication.
 *
 * Pure translation. Note what is absent: no branch here decides whether a login
 * succeeded — the service raises a domain error and the global handler turns it
 * into a 401, so the "wrong password and unknown user look identical" property
 * cannot be broken by a careless edit in a controller.
 */
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  register = async (req: Request, res: Response): Promise<void> => {
    const { username, password } = validated<CredentialsBody>(req, 'body');
    const session = await this.authService.register(username, password);
    res.status(201).json(this.ok(req, toSessionResponse(session)));
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const { username, password } = validated<CredentialsBody>(req, 'body');
    const session = await this.authService.login(username, password);
    res.status(200).json(this.ok(req, toSessionResponse(session)));
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    // `authenticate` has already proved the token resolves, so it is present.
    await this.authService.logout(req.authToken ?? '');
    res.status(204).send();
  };

  me = (req: Request, res: Response): Promise<void> => {
    const player = toPlayerResponse(toPlayerIdentity(currentUser(req)));
    res.status(200).json(this.ok(req, player));
    return Promise.resolve();
  };

  private ok<T extends SessionResponse | PlayerResponse>(
    req: Request,
    data: T,
  ): SuccessResponse<T> {
    return {
      data,
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

function toSessionResponse(session: AuthenticatedSession): SessionResponse {
  return { player: toPlayerResponse(session.player), token: session.token };
}
