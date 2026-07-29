import { type Provider } from '@nestjs/common';

import { APP_CONFIG } from '../../config/config.module';
import { type AppConfig } from '../../config/env.schema';
import { DICE_GENERATOR, type DiceGenerator } from '../ports/dice-generator.port';
import { CryptoDiceGenerator } from './crypto-dice.generator';
import { DeterministicDiceGenerator } from './deterministic-dice.generator';

/**
 * The one place a dice generator is chosen.
 *
 * **The deterministic generator must be unreachable in production.** A scripted
 * die that shipped would hand the outcome of every match to anyone who read this
 * repository — `DEFAULT_DICE_SEQUENCE` is right there in the next file.
 *
 * It is bound only when `DICE_SOURCE=scripted`, which is a variable that exists
 * for this decision and nothing else. It used to be bound by `NODE_ENV === 'test'`,
 * and that was the flaw: one variable answered two unrelated questions — *are the
 * dice predictable* and *may this process skip every production refusal* — so a
 * single mis-set `NODE_ENV` produced predictable dice **and** the committed
 * development `JWT_SECRET` in the same breath. Two independent mistakes now have
 * to be made together, and `env.schema.ts` refuses `scripted` in production
 * outright.
 *
 * Three details are deliberate:
 *
 *  - The decision reads `AppConfig`, not `process.env`. The environment is
 *    validated once at boot and nothing else in the API reads `process.env`; a
 *    typo in an env name would otherwise be indistinguishable from "not
 *    scripted", which is the safe direction here but the wrong habit everywhere
 *    else.
 *  - The condition names the *scripted* case, so an unrecognised value falls
 *    through to the CSPRNG. It fails closed.
 *  - This lives in its own file rather than inline in `games.module.ts` so the
 *    test beside it can resolve the binding through a real Nest container
 *    without dragging in the rest of the module graph.
 */
export const diceGeneratorProvider: Provider = {
  provide: DICE_GENERATOR,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): DiceGenerator =>
    config.diceSource === 'scripted' ? new DeterministicDiceGenerator() : new CryptoDiceGenerator(),
};
