import { type ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { codeFor, messageFor } from '@/lib/error-messages';

export type AlertTone = 'error' | 'info';

const TONES: Readonly<Record<AlertTone, string>> = Object.freeze({
  error: 'border-danger/50 bg-danger/10 text-danger',
  info: 'border-line bg-raised/60 text-subtle',
});

export function Alert({
  tone = 'error',
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <p
      // `alert` for a failure, so it is announced the moment it appears;
      // `status` for anything else, so it does not interrupt.
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-lg border px-3 py-2 text-sm', TONES[tone], className)}
    >
      {children}
    </p>
  );
}

/**
 * An `ApiError` rendered for a player, with the machine-readable code kept
 * visible in small print — it is the thing worth quoting in a bug report, and
 * hiding it helps nobody.
 */
export function ErrorAlert({
  error,
  className,
}: {
  error: unknown;
  className?: string | undefined;
}): React.JSX.Element | null {
  if (error == null) {
    return null;
  }

  const code = codeFor(error);

  return (
    <Alert tone="error" className={className}>
      {messageFor(error)}
      {/* The code is small print, not faint print. At `opacity-70` it measured
          3.5:1 against the alert's own fill; at full opacity it is 5.66:1. */}
      {code !== null && <span className="ml-2 font-mono text-[11px]">{code}</span>}
    </Alert>
  );
}
