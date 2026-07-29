import {
  createGameRequestSchema,
  type CreateGameRequest,
  type GameIdParam,
  gameIdParamSchema,
  type GameView,
  type HoldRequest,
  holdRequestSchema,
  type NewGameRequest,
  newGameRequestSchema,
  type RollRequest,
  rollRequestSchema,
  ROUTES,
} from '@dice-game/contracts';
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { type RequestUser } from '../common/http/request-context';
import { ZodBody, ZodParam } from '../common/pipes/zod-validation.pipe';
import { GamesService } from './games.service';

/**
 * The five endpoints in `ROUTES.games`, and nothing else.
 *
 * Three properties hold across all of them:
 *
 *  - **No `@Public()` anywhere.** The global `APP_GUARD` protects every route by
 *    default and this controller never opts out — `PUBLIC_ROUTES` in the
 *    contract names four routes and none of them are here. The previous
 *    generation opted *in* per router and shipped five unauthenticated gameplay
 *    endpoints while its README claimed the opposite.
 *  - **Identity never comes from a body.** Not one of these handlers reads an
 *    actor id from the request; `@CurrentUser()` reads it from the verified
 *    token, and it throws rather than returning `undefined` if no guard ran. The
 *    contract's write schemas are `.strict()`, so a client that tried to smuggle
 *    a `userId` gets a validation error rather than being quietly ignored.
 *  - **The handlers decide nothing.** Each one validates, delegates and returns
 *    a `GameView`; `ResponseEnvelopeInterceptor` wraps it in `{ data, meta }`.
 *
 * The `/api` prefix is set globally in `main.ts`, so `@Controller('games')`
 * mounts exactly the paths the contract's route table names.
 */
@ApiTags('games')
@ApiBearerAuth('access-token')
@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  /**
   * `POST /api/games` — start a match.
   *
   * 201, because this is the one command here that brings a resource into
   * existence. The others act on one that already does.
   */
  @Post()
  @ApiOperation({ summary: 'Start a match against another player', operationId: 'createGame' })
  create(
    @CurrentUser() actor: RequestUser,
    @ZodBody(createGameRequestSchema) body: CreateGameRequest,
  ): Promise<GameView> {
    return this.games.create(actor, body);
  }

  /**
   * `GET /api/games/:gameId` — the board, for a player who is in this match.
   *
   * A non-participant gets `NOT_A_PARTICIPANT`, not the board.
   */
  @Get(':gameId')
  @ApiOperation({ summary: 'Read a game you are playing in', operationId: 'getGame' })
  findOne(
    @CurrentUser() actor: RequestUser,
    @ZodParam(gameIdParamSchema) params: GameIdParam,
  ): Promise<GameView> {
    return this.games.findForViewer(actor, params.gameId);
  }

  /**
   * `POST /api/games/:gameId/roll` — throw the pair.
   *
   * The body carries `expectedRevision` and nothing else. There is no field
   * here through which a modified client could name a die, a score or a player.
   *
   * 200 rather than 201: a roll changes a game, it does not create one.
   */
  @Post(':gameId/roll')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Roll the dice', operationId: 'rollDice' })
  roll(
    @CurrentUser() actor: RequestUser,
    @ZodParam(gameIdParamSchema) params: GameIdParam,
    @ZodBody(rollRequestSchema) body: RollRequest,
  ): Promise<GameView> {
    return this.games.roll(actor, params.gameId, body);
  }

  /** `POST /api/games/:gameId/hold` — bank the round score and pass the dice. */
  @Post(':gameId/hold')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bank the round score', operationId: 'hold' })
  hold(
    @CurrentUser() actor: RequestUser,
    @ZodParam(gameIdParamSchema) params: GameIdParam,
    @ZodBody(holdRequestSchema) body: HoldRequest,
  ): Promise<GameView> {
    return this.games.hold(actor, params.gameId, body);
  }

  /**
   * `POST /api/games/:gameId/new-game` — start the next game in the series.
   *
   * Legal at any time, including mid-game, and may raise or lower the winning
   * score for the new game only.
   */
  @Post(':gameId/new-game')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start the next game between the same players', operationId: 'newGame' })
  newGame(
    @CurrentUser() actor: RequestUser,
    @ZodParam(gameIdParamSchema) params: GameIdParam,
    @ZodBody(newGameRequestSchema) body: NewGameRequest,
  ): Promise<GameView> {
    return this.games.newGame(actor, params.gameId, body);
  }
}

/**
 * The paths this controller must serve, as the contract names them. Exported so
 * a test can assert the two still agree rather than trusting the decorators.
 */
export const GAMES_ROUTES = ROUTES.games;
