import type { Server } from 'node:http';

import { createContainer } from './container';
import type { Logger } from './infrastructure/logging/logger';

/**
 * Process entry point: bootstrap, signal handling, and graceful shutdown.
 *
 * Kept separate from `createApp` so nothing here — ports, signals, `process.exit`
 * — is ever loaded by the test suite.
 */
function bootstrap(): void {
  const container = createContainer();
  const { env, logger, app, setReady } = container;

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      { port: env.PORT, host: env.HOST, nodeEnv: env.NODE_ENV, pid: process.pid },
      'Dice game service listening.',
    );
  });

  // Must exceed the upstream load balancer's idle timeout, otherwise the LB can
  // dispatch onto a connection Node is simultaneously closing — the classic
  // source of sporadic 502s behind ALB/nginx.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.fatal({ err: error, port: env.PORT }, 'Port already in use; cannot start.');
    } else {
      logger.fatal({ err: error }, 'HTTP server error.');
    }
    process.exit(1);
  });

  registerShutdownHandlers({ server, logger, setReady, timeoutMs: env.SHUTDOWN_TIMEOUT_MS });
}

interface ShutdownOptions {
  readonly server: Server;
  readonly logger: Logger;
  readonly setReady: (ready: boolean) => void;
  readonly timeoutMs: number;
}

function registerShutdownHandlers(options: ShutdownOptions): void {
  const { server, logger, setReady, timeoutMs } = options;
  let shuttingDown = false;

  const shutdown = (signal: string, exitCode: number): void => {
    // A second SIGTERM during drain must not restart the sequence.
    if (shuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress; ignoring signal.');
      return;
    }
    shuttingDown = true;

    logger.info({ signal, timeoutMs }, 'Shutdown signal received; draining.');

    // Step 1: fail readiness first. The load balancer stops sending new traffic
    // while the server is still able to serve what is already queued. Closing
    // the server first would reject requests the LB has not yet learned to stop
    // sending — this ordering is what makes a rolling deploy lossless.
    setReady(false);

    // Step 2: stop accepting connections; the callback fires once in-flight
    // requests have completed.
    server.close((error) => {
      clearTimeout(forceTimer);

      if (error) {
        logger.error({ err: error }, 'Error while closing HTTP server.');
        process.exit(1);
      }

      logger.info('Drain complete; exiting.');
      process.exit(exitCode);
    });

    // Step 3: bound the wait. A hung keep-alive connection must never prevent
    // the container from exiting, or the orchestrator SIGKILLs us anyway —
    // worse, without a log line explaining why.
    const forceTimer = setTimeout(() => {
      logger.fatal({ timeoutMs }, 'Drain exceeded timeout; forcing exit.');
      process.exit(1);
    }, timeoutMs);

    // Do not let the force-timer itself keep the event loop alive.
    forceTimer.unref();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM', 0);
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT', 0);
  });

  // An uncaught exception leaves the process in an undefined state — there is no
  // safe way to continue. Log with full fidelity, then drain and die so the
  // orchestrator replaces us with a clean process.
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception; shutting down.');
    shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection; shutting down.');
    shutdown('unhandledRejection', 1);
  });
}

bootstrap();
