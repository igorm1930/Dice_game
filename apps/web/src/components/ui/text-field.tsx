import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cx } from '@/lib/cx';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  /** The validation message, when there is one. Announced, not just coloured. */
  error?: string | undefined;
  hint?: ReactNode;
}

/**
 * A labelled input.
 *
 * The label is a real `<label for>`, the error is tied to the input with
 * `aria-describedby` and mirrored in `aria-invalid`, and the error text carries
 * `role="alert"` so it is announced when it appears rather than only being red.
 *
 * `forwardRef` because React Hook Form registers the input by ref.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, error, hint, className, ...rest },
  ref,
) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = cx(hint != null ? hintId : '', error != null ? errorId : '');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </label>

      <input
        {...rest}
        id={id}
        ref={ref}
        aria-invalid={error != null}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        className={cx(
          'w-full rounded-lg border bg-canvas/70 px-3 py-2.5 text-sm text-ink',
          // `/60` measured 3.84:1 against the field's fill. `/80` is 5.96:1 and
          // still reads as placeholder rather than as a typed value.
          'placeholder:text-subtle/80 transition',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          error != null ? 'border-danger' : 'border-line hover:border-accent/60',
          className,
        )}
      />

      {hint != null && (
        <p id={hintId} className="text-xs text-subtle">
          {hint}
        </p>
      )}

      {error != null && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
