import { CryptoRandomGenerator } from '../../src/infrastructure/random/crypto-random.generator';

describe('CryptoRandomGenerator', () => {
  const random = new CryptoRandomGenerator();

  it('treats both bounds as inclusive', () => {
    // 2000 draws over a 2-value range: the probability of missing either
    // endpoint by chance is astronomically small, so this is not flaky.
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      seen.add(random.nextInt(1, 2));
    }

    expect([...seen].sort()).toEqual([1, 2]);
  });

  it('stays within the requested range', () => {
    for (let i = 0; i < 2000; i += 1) {
      const value = random.nextInt(1, 6);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('handles a single-value range', () => {
    expect(random.nextInt(4, 4)).toBe(4);
  });

  it('covers every face of a die', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i += 1) {
      seen.add(random.nextInt(1, 6));
    }

    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects non-integer bounds', () => {
    expect(() => random.nextInt(1.5, 6)).toThrow(TypeError);
    expect(() => random.nextInt(1, 6.5)).toThrow(TypeError);
  });

  it('rejects an inverted range', () => {
    expect(() => random.nextInt(6, 1)).toThrow(RangeError);
  });

  /**
   * Guards the reason `crypto.randomInt` was chosen over
   * `Math.floor(Math.random() * n)`: the naive form is modulo-biased. A uniform
   * distribution over 6 faces should land every face within a wide tolerance of
   * the expected 1/6.
   */
  it('produces a roughly uniform distribution', () => {
    const draws = 60_000;
    const counts = new Map<number, number>();

    for (let i = 0; i < draws; i += 1) {
      const value = random.nextInt(1, 6);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    const expected = draws / 6;
    for (const face of [1, 2, 3, 4, 5, 6]) {
      const count = counts.get(face) ?? 0;
      expect(count).toBeGreaterThan(expected * 0.9);
      expect(count).toBeLessThan(expected * 1.1);
    }
  });
});
