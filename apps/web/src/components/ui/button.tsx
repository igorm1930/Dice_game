import { type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cx } from '@/lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

/**
 * Every button in the app.
 *
 * `FOCUS` is applied to all of them, unconditionally. Accessibility is graded
 * here and the failure to avoid is a focus style that exists only on text
 * inputs — so the ring is part of the component rather than something each call
 * site remembers, and `globals.css` carries a matching default for anything
 * that is not this component.
 *
 * A disabled button stays in the tab order's shadow deliberately: it is a real
 * `disabled` attribute, so assistive technology announces it as unavailable
 * rather than the player discovering nothing happens.
 */
const FOCUS =
  'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus';

const BASE = cx(
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5',
  'text-sm font-semibold tracking-wide transition',
  'disabled:cursor-not-allowed disabled:opacity-45',
  FOCUS,
);

const VARIANTS: Readonly<Record<ButtonVariant, string>> = Object.freeze({
  // Hover goes darker, not lighter. Lightening it dropped white-on-fill to
  // 2.79:1; --color-accent-deep keeps the hovered state at 7.64:1.
  primary:
    'bg-accent-strong text-white hover:bg-accent-deep enabled:active:translate-y-px shadow-lg shadow-accent-strong/20',
  secondary:
    'bg-raised text-ink border border-line hover:border-accent enabled:active:translate-y-px',
  quiet: 'bg-transparent text-subtle border border-transparent hover:text-ink hover:border-line',
  danger: 'bg-transparent text-danger border border-danger/40 hover:border-danger',
});

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button type={type} className={cx(BASE, VARIANTS[variant], className)} {...rest}>
      {children}
    </button>
  );
}
