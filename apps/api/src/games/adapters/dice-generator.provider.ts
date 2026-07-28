import { type Provider } from '@nestjs/common';

import { APP_CONFIG } from '../../config/config.module';
import { type AppConfig } from '../../config/env.schema';
import { DICE_GENERATOR, type DiceGenerator } from '../ports/dice-generator.port';
import { CryptoDiceGenerator } from './crypto-dice.generator';
import { DeterministicDiceGenerator } from './deterministic-dice.generator';

/**
 * The one place a dice generator is chosen.
 *
 * **The deterministic generator must be unreachable in production.** It is
 * bound only when `NODE_ENV === 'test'`; development and production both get
 * the CSPRNG. A scripted die that shipped would hand the outcome of every match
 * to anyone who read this repository.
 *
 * Three details are deliberate:
 *
 *  - The decision reads `AppConfig.isTest`, not `process.env.NODE_ENV`. The
 *    environment is validated once at boot (`config/env.schema.ts`) and nothing
 *    else in the API reads `process.env`; a typo in an env name would otherwise
 *    be indistinguishable from "not test", which is the safe direction here but
 *    the wrong habit everywhere else.
 *  - The default is the crypto generator. The condition names the *test* case,
 *    so an unrecognised environment fails closed onto real randomness.
 *  - This lives in its own file rather than inline in `games.module.ts` so the
 *    test beside it can resolve the binding through a real Nest container
 *    without dragging in the rest of the module graph.
 */
export const diceGeneratorProvider: Provider = {
  provide: DICE_GENERATOR,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): DiceGenerator =>
    config.isTest ? new DeterministicDiceGenerator() : new CryptoDiceGenerator(),
};
