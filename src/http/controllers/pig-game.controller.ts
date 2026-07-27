import type { Request, Response } from 'express';

import type { PigGameService } from '../../core/services/pig-game.service';
import type { SuccessResponse } from '../dto/api-response';
import type { NewPigGameBody, PigGameResponse } from '../dto/pig-game.dto';
import { toPigGameResponse } from '../mappers/pig-game.mapper';
import { validated } from '../middleware/validate.middleware';

/**
 * HTTP adapter for the Pig game.
 *
 * Pure translation, like GameController: call the service, map the state,
 * return it. Actions respond 200 with the full updated state — they mutate a
 * singleton rather than create addressable resources, so 201/Location would
 * be a lie. Errors propagate to the global error middleware.
 */
export class PigGameController {
  constructor(private readonly pigGameService: PigGameService) {}

  getState = async (req: Request, res: Response): Promise<void> => {
    const state = await this.pigGameService.getState();
    res.status(200).json(this.ok(req, toPigGameResponse(state)));
  };

  roll = async (req: Request, res: Response): Promise<void> => {
    const state = await this.pigGameService.roll();
    res.status(200).json(this.ok(req, toPigGameResponse(state)));
  };

  hold = async (req: Request, res: Response): Promise<void> => {
    const state = await this.pigGameService.hold();
    res.status(200).json(this.ok(req, toPigGameResponse(state)));
  };

  newGame = async (req: Request, res: Response): Promise<void> => {
    const body = validated<NewPigGameBody>(req, 'body');
    const state = await this.pigGameService.newGame(body.targetScore);
    res.status(200).json(this.ok(req, toPigGameResponse(state)));
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
