import { Injectable } from '@nestjs/common';

import { type Clock } from '../ports/clock.port';

/** The wall clock. The only place in the games module that reads it. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
