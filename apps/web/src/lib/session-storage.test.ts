import { describe, expect, it } from 'vitest';

import { ADA, TOKEN_A } from '@/test/fixtures';

import {
  clearSeatSession,
  readActiveGameId,
  readSeatSession,
  writeActiveGameId,
  writeSeatSession,
} from './session-storage';

const KEY_A = 'dice-game:v1:seat:A';

describe('what a seat may leave behind', () => {
  it('stores the token and the two rendered fields under a versioned key', () => {
    writeSeatSession('A', { accessToken: TOKEN_A, user: { id: ADA.id, displayName: 'Ada' } });

    expect(JSON.parse(window.sessionStorage.getItem(KEY_A) ?? 'null')).toEqual({
      accessToken: TOKEN_A,
      user: { id: ADA.id, displayName: 'Ada' },
    });
  });

  it('keeps the two seats in separate slots', () => {
    writeSeatSession('A', { accessToken: 'a', user: { id: ADA.id, displayName: 'Ada' } });
    writeSeatSession('B', { accessToken: 'b', user: { id: ADA.id, displayName: 'Grace' } });

    expect(readSeatSession('A')?.accessToken).toBe('a');
    expect(readSeatSession('B')?.accessToken).toBe('b');

    clearSeatSession('A');

    expect(readSeatSession('A')).toBeNull();
    expect(readSeatSession('B')?.accessToken).toBe('b');
  });

  it('discards a stored value the contract’s primitives no longer accept', () => {
    // What a previous version of this app might have written, or what a
    // tampering script might leave: the shape is wrong, so it is dropped rather
    // than rendered.
    window.sessionStorage.setItem(KEY_A, JSON.stringify({ token: TOKEN_A, name: 'Ada' }));

    expect(readSeatSession('A')).toBeNull();
    expect(window.sessionStorage.getItem(KEY_A)).toBeNull();
  });

  it('discards a value that is not JSON at all', () => {
    window.sessionStorage.setItem(KEY_A, 'not json');

    expect(readSeatSession('A')).toBeNull();
  });

  it('only restores a game id that could be one', () => {
    writeActiveGameId('0123456789abcdef01234567');
    expect(readActiveGameId()).toBe('0123456789abcdef01234567');

    writeActiveGameId('../../etc/passwd');
    expect(readActiveGameId()).toBeNull();
  });
});
