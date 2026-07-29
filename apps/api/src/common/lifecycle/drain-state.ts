import { Injectable } from '@nestjs/common';

/**
 * Whether this instance is draining.
 *
 * One boolean, shared by the SIGTERM handler in `main.ts` and the readiness
 * probe. The ordering it enables is the whole point: readiness starts failing
 * *before* the server stops accepting connections, so the load balancer removes
 * this instance from rotation while it can still finish the requests it already
 * has. Closing the listener first would drop requests that were already in
 * flight and would let the balancer keep sending more until its next poll.
 *
 * One-way on purpose. There is no `endDrain()`: a process that has begun
 * shutting down does not come back, and an instance that could flip readiness
 * on again would hide a half-dead worker behind a healthy probe.
 */
@Injectable()
export class DrainState {
  private draining = false;

  get isDraining(): boolean {
    return this.draining;
  }

  beginDrain(): void {
    this.draining = true;
  }
}
