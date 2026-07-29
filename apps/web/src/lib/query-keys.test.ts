import { describe, expect, it } from 'vitest';

import { GAME_ID } from '@/test/fixtures';

import { belongsToSeat, queryKeys } from './query-keys';

/**
 * The cache keys, tested directly.
 *
 * These are a component test's blind spot. Only one panel on the page fetches
 * the user list, so dropping the seat from that key changes nothing anybody can
 * see — the key factory has to be asserted for what it *is*, not for what one
 * caller happens to do with it. The property in every case is the same one:
 * two different askers must never share an entry, because the answers differ
 * per asker.
 */
const ADA_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const LINUS_ID = 'cccccccccccccccccccccccc';

describe('game keys', () => {
  it('separates the two seats', () => {
    expect(queryKeys.game(GAME_ID, 'A', ADA_ID)).not.toEqual(queryKeys.game(GAME_ID, 'B', ADA_ID));
  });

  it('separates two occupants of the same seat', () => {
    // `availableActions` and `viewerSeat` are relative to the token that asked.
    // A seat that changes hands must not inherit the previous occupant's answer.
    expect(queryKeys.game(GAME_ID, 'A', ADA_ID)).not.toEqual(
      queryKeys.game(GAME_ID, 'A', LINUS_ID),
    );
  });

  it('separates two games', () => {
    expect(queryKeys.game(GAME_ID, 'A', ADA_ID)).not.toEqual(
      queryKeys.game('0123456789abcdef0123beef', 'A', ADA_ID),
    );
  });

  it('puts every seat’s entry under the one root the commands invalidate', () => {
    const root = queryKeys.gameRoot(GAME_ID);

    for (const key of [
      queryKeys.game(GAME_ID, 'A', ADA_ID),
      queryKeys.game(GAME_ID, 'B', ADA_ID),
    ]) {
      expect(key.slice(0, root.length)).toEqual([...root]);
    }
  });
});

describe('user-list keys', () => {
  it('separates the two seats', () => {
    // The list is fetched with one seat's token and is that seat's answer. One
    // panel asks for it today; the key is what stops a second one being served
    // the first one's response.
    expect(queryKeys.users('A', ADA_ID)).not.toEqual(queryKeys.users('B', ADA_ID));
  });

  it('separates two occupants of the same seat', () => {
    expect(queryKeys.users('A', ADA_ID)).not.toEqual(queryKeys.users('A', LINUS_ID));
  });
});

describe('recognising a seat’s entries', () => {
  it('claims that seat’s game and user-list keys', () => {
    expect(belongsToSeat(queryKeys.game(GAME_ID, 'A', ADA_ID), 'A')).toBe(true);
    expect(belongsToSeat(queryKeys.users('A', ADA_ID), 'A')).toBe(true);
  });

  it('claims them whoever is sitting there', () => {
    expect(belongsToSeat(queryKeys.game(GAME_ID, 'A', LINUS_ID), 'A')).toBe(true);
  });

  it('leaves the other seat’s entries alone', () => {
    expect(belongsToSeat(queryKeys.game(GAME_ID, 'B', ADA_ID), 'A')).toBe(false);
    expect(belongsToSeat(queryKeys.users('B', ADA_ID), 'A')).toBe(false);
  });

  it('leaves anything that is not a seat’s entry alone', () => {
    expect(belongsToSeat(queryKeys.gameRoot(GAME_ID), 'A')).toBe(false);
    expect(belongsToSeat(['something', 'else'], 'A')).toBe(false);
  });
});
