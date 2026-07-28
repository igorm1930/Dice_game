import { describe, expect, it } from 'vitest';

import { UnsupportedRulesetError } from '../errors';
import {
  DEFAULT_RULESET_REF,
  RULESET_ALLOW_LIST,
  resolveRules,
  rulesetKey,
  supportedRulesetKeys,
} from './registry';
import { standardRulesV1 } from './standard-v1';

describe('ruleset registry', () => {
  it('resolves standard@1 to the compiled-in policy', () => {
    expect(resolveRules({ id: 'standard', version: 1 })).toBe(standardRulesV1);
  });

  it('resolves the default ref new games are created under', () => {
    expect(resolveRules(DEFAULT_RULESET_REF)).toBe(standardRulesV1);
  });

  it('keys a ref as `id@version`', () => {
    expect(rulesetKey({ id: 'standard', version: 1 })).toBe('standard@1');
  });

  it('allow-lists exactly one ruleset today', () => {
    expect(supportedRulesetKeys()).toEqual(['standard@1']);
  });

  it('throws UnsupportedRulesetError for an unknown id', () => {
    expect(() => resolveRules({ id: 'nonsense', version: 1 })).toThrow(UnsupportedRulesetError);
  });

  it('throws UnsupportedRulesetError for standard@2', () => {
    expect(() => resolveRules({ id: 'standard', version: 2 })).toThrow(UnsupportedRulesetError);
  });

  it('carries the rejected ref in the error details so a log names it', () => {
    expect.assertions(3);

    try {
      resolveRules({ id: 'standard', version: 2 });
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedRulesetError);
      expect((error as UnsupportedRulesetError).code).toBe('UNSUPPORTED_RULESET');
      expect((error as UnsupportedRulesetError).details).toEqual({ id: 'standard', version: 2 });
    }
  });

  it('cannot be extended at runtime — nothing executable may come from data', () => {
    expect(Object.isFrozen(RULESET_ALLOW_LIST)).toBe(true);

    expect(() => {
      (RULESET_ALLOW_LIST as Record<string, unknown>)['evil@1'] = standardRulesV1;
    }).toThrow(TypeError);

    expect(() => resolveRules({ id: 'evil', version: 1 })).toThrow(UnsupportedRulesetError);
  });

  it('cannot have an existing entry replaced at runtime', () => {
    expect(() => {
      (RULESET_ALLOW_LIST as Record<string, unknown>)['standard@1'] = { id: 'standard' };
    }).toThrow(TypeError);

    expect(resolveRules({ id: 'standard', version: 1 })).toBe(standardRulesV1);
  });

  it('hands out a copy of its keys, not a handle on the table', () => {
    const keys = supportedRulesetKeys();

    expect(Object.isFrozen(keys)).toBe(true);
    expect(supportedRulesetKeys()).not.toBe(keys);
  });
});
