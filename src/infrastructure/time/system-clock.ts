import type { Clock } from '../../core/ports/clock.port';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
