import { cx } from '@/lib/cx';

/**
 * A pending indicator.
 *
 * `aria-hidden`, and always paired with visible text — a spinner alone tells a
 * screen-reader user nothing, and the text is what actually says what is
 * pending.
 */
export function Spinner({ className }: { className?: string | undefined }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

/** A block-level "this panel is loading" state, announced politely. */
export function LoadingBlock({ label }: { label: string }): React.JSX.Element {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-subtle">
      <Spinner />
      {label}
    </p>
  );
}
