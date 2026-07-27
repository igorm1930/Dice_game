import { AsyncMutex } from '../../src/infrastructure/concurrency/async-mutex';

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('AsyncMutex', () => {
  it('serialises tasks sharing a key', async () => {
    const mutex = new AsyncMutex();
    const events: string[] = [];

    const task = (name: string, delay: number): Promise<void> =>
      mutex.withLock('shared', async () => {
        events.push(`${name}:start`);
        await tick(delay);
        events.push(`${name}:end`);
      });

    // `b` is deliberately faster; without the lock it would finish inside `a`.
    await Promise.all([task('a', 20), task('b', 1)]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('does not block across different keys', async () => {
    const mutex = new AsyncMutex();
    const events: string[] = [];

    await Promise.all([
      mutex.withLock('one', async () => {
        events.push('one:start');
        await tick(20);
        events.push('one:end');
      }),
      mutex.withLock('two', async () => {
        events.push('two:start');
        await tick(1);
        events.push('two:end');
      }),
    ]);

    // Interleaving proves the keys are independent.
    expect(events).toEqual(['one:start', 'two:start', 'two:end', 'one:end']);
  });

  it('releases the lock when the task throws', async () => {
    const mutex = new AsyncMutex();

    await expect(mutex.withLock('key', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );

    // A leaked lock would deadlock this second acquisition.
    await expect(mutex.withLock('key', () => Promise.resolve('recovered'))).resolves.toBe(
      'recovered',
    );
  });

  it('isolates a rejection from the next holder of the same key', async () => {
    const mutex = new AsyncMutex();

    const failing = mutex.withLock('key', () => Promise.reject(new Error('first fails')));
    const following = mutex.withLock('key', () => Promise.resolve('second succeeds'));

    await expect(failing).rejects.toThrow('first fails');
    await expect(following).resolves.toBe('second succeeds');
  });

  it('does not leak map entries once a key drains', async () => {
    const mutex = new AsyncMutex();

    await Promise.all([
      mutex.withLock('a', () => tick(1)),
      mutex.withLock('b', () => tick(1)),
      mutex.withLock('a', () => tick(1)),
    ]);

    expect(mutex.size).toBe(0);
  });

  it('propagates the task result to the caller', async () => {
    const mutex = new AsyncMutex();

    await expect(mutex.withLock('k', () => Promise.resolve(42))).resolves.toBe(42);
  });

  it('preserves arrival order under contention', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        mutex.withLock('same', async () => {
          await tick(1);
          order.push(n);
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});
