import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../../config/config.module';
import { type AppConfig, parseAppConfig } from '../../config/env.schema';
import { DICE_GENERATOR, type DiceGenerator } from '../ports/dice-generator.port';
import { CryptoDiceGenerator } from './crypto-dice.generator';
import { DeterministicDiceGenerator } from './deterministic-dice.generator';
import { diceGeneratorProvider } from './dice-generator.provider';

/**
 * **A test-only cheat that ships is a cheat.**
 *
 * The deterministic generator exists so unit tests and Playwright can script a
 * match. If it were ever bound outside `NODE_ENV=test`, every roll in
 * production would be predictable from a file in this repository — and the
 * failure would be silent, because a scripted game plays exactly like a random
 * one until somebody notices the sequence.
 *
 * So these resolve the binding through a real Nest container, under a real
 * parsed `AppConfig`, and assert what comes out. They are the reason
 * `diceGeneratorProvider` lives in a file of its own: asserting on the provider
 * the module actually registers is worth more than asserting on a copy of the
 * condition.
 */

/**
 * Built with the application's own loader rather than a hand-written literal,
 * so these run against the same validation the process boots with — including
 * the refinement that refuses a production start on the committed dev secret.
 */
function configFor(env: Record<string, string | undefined>): AppConfig {
  return parseAppConfig({
    JWT_SECRET: 'a-production-secret-of-entirely-sufficient-length',
    CORS_ORIGIN: 'https://dice.example',
    ...env,
  });
}

async function resolveDice(env: Record<string, string | undefined>): Promise<DiceGenerator> {
  const moduleRef = await Test.createTestingModule({
    providers: [{ provide: APP_CONFIG, useValue: configFor(env) }, diceGeneratorProvider],
  }).compile();

  return moduleRef.get<DiceGenerator>(DICE_GENERATOR);
}

describe('the dice binding', () => {
  it('gives a production container the CSPRNG', async () => {
    const dice = await resolveDice({ NODE_ENV: 'production' });

    expect(dice).toBeInstanceOf(CryptoDiceGenerator);
  });

  it('never gives a production container the scripted dice', async () => {
    const dice = await resolveDice({ NODE_ENV: 'production' });

    expect(dice).not.toBeInstanceOf(DeterministicDiceGenerator);
  });

  it('gives a development container the CSPRNG too', async () => {
    // Only `test` is special. An unrecognised environment would fail validation
    // before reaching here, but the condition is written so that the *test* case
    // is the named one — anything else falls through to real randomness.
    const dice = await resolveDice({ NODE_ENV: 'development' });

    expect(dice).toBeInstanceOf(CryptoDiceGenerator);
  });

  it('gives a test container the scripted dice', async () => {
    const dice = await resolveDice({ NODE_ENV: 'test' });

    expect(dice).toBeInstanceOf(DeterministicDiceGenerator);
  });

  it('resolves a generator that actually satisfies the port', async () => {
    const dice = await resolveDice({ NODE_ENV: 'production' });

    expect(dice.rollPair()).toHaveLength(2);
  });
});
