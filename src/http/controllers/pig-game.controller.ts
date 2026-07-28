import type { Request, Response } from 'express';

import type { AuthService } from '../../core/services/auth.service';
import type { PigGameService } from '../../core/services/pig-game.service';
import type { SuccessResponse } from '../dto/api-response';
import type { NewPigGameBody, PigGameResponse } from '../dto/pig-game.dto';
import { toPigGameResponse } from '../mappers/pig-game.mapper';
import { currentUser } from '../middleware/authenticate.middleware';
import { validated } from '../middleware/validate.middleware';

/**
 * HTTP adapter for the Pig game.
 *
 * Pure translation: read the authenticated player off the request, call the
 * service, map the state. Actions respond 200 with the full updated state —
 * they mutate a shared table rather than create addressable resources, so
 * 201/Location would be a lie. Errors propagate to the global error middleware.
 */
export class PigGameController {
  constructor(
    private readonly pigGameService: PigGameService,
    private readonly authService: AuthService,
  ) {}

  getState = async (req: Request, res: Response): Promise<void> => {
    const view = await this.pigGameService.getState(currentUser(req));
    res.status(200).json(this.ok(req, toPigGameResponse(view)));
  };

  roll = async (req: Request, res: Response): Promise<void> => {
    const view = await this.pigGameService.roll(currentUser(req));
    res.status(200).json(this.ok(req, toPigGameResponse(view)));
  };

  hold = async (req: Request, res: Response): Promise<void> => {
    const view = await this.pigGameService.hold(currentUser(req));
    res.status(200).json(this.ok(req, toPigGameResponse(view)));
  };

  newGame = async (req: Request, res: Response): Promise<void> => {
    const body = validated<NewPigGameBody>(req, 'body');
    const creator = currentUser(req);
    // Resolving the opponent by name is an identity lookup, so it belongs to
    // the auth service; an unknown name is a 404 before the game is touched.
    const opponent = await this.authService.requireByUsername(body.opponent);

    const view = await this.pigGameService.newGame({
      creator,
      opponent,
      targetScore: body.targetScore,
    });

    res.status(201).json(this.ok(req, toPigGameResponse(view)));
  };

  private ok(req: Request, data: PigGameResponse): SuccessResponse<PigGameResponse> {
    return {
      data,
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
