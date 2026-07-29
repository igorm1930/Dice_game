import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { E2E_MONGODB_URI } from './support/config';

/**
 * Empties the end-to-end database before a run.
 *
 * Every test creates its own accounts with fresh addresses, so nothing here is
 * load-bearing for correctness — it stops a database that only ever grows.
 *
 * Two details are deliberate:
 *
 *  - **Documents are deleted; the database is not dropped.** Playwright starts
 *    `webServer` processes before `globalSetup` runs, so by this point the API
 *    has already connected and built its indexes. Dropping the database would
 *    take the unique index on `email` with it, and the next run would be testing
 *    an API that quietly allows duplicate registrations.
 *  - **The driver is the API's own.** `apps/web` has no MongoDB dependency and
 *    should not acquire one to clean up after itself, so the work runs as a
 *    short script in `apps/api`, where `mongoose` is a real dependency. Nothing
 *    in `apps/api` is modified; only its `node_modules` is borrowed.
 */
const CLEAN_SCRIPT = `
const mongoose = require('mongoose');

mongoose
  .createConnection(process.env.E2E_MONGODB_URI)
  .asPromise()
  .then(async (connection) => {
    const collections = await connection.db.listCollections().toArray();

    for (const collection of collections) {
      await connection.db.collection(collection.name).deleteMany({});
    }

    await connection.close();
  })
  .catch((error) => {
    process.stderr.write('Could not empty the e2e database: ' + String(error) + '\\n');
    process.exit(1);
  });
`;

export default function globalSetup(): void {
  execFileSync(process.execPath, ['-e', CLEAN_SCRIPT], {
    cwd: path.join(__dirname, '..', '..', 'api'),
    env: { ...process.env, E2E_MONGODB_URI },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
