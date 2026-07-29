/**
 * The API origin.
 *
 * Next inlines `NEXT_PUBLIC_*` at build time, so this must be written as a
 * literal member access — a computed lookup would survive into the bundle as a
 * runtime read of an object that does not exist in the browser.
 *
 * The fallback is the port `compose.yaml` and `.env.example` agree on, so a
 * contributor who has not written a `.env.local` still gets a working client
 * against `pnpm dev`.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
