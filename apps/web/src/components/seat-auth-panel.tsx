'use client';

import {
  type AuthSession,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  type LoginRequest,
  loginRequestSchema,
  PASSWORD_MIN_LENGTH,
  type RegisterRequest,
  registerRequestSchema,
} from '@dice-game/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { useSeat, useSeatSessions } from '@/hooks/seat-sessions';
import { login, register as registerAccount } from '@/lib/api';
import { cx } from '@/lib/cx';
import { SEAT_LABELS, type SeatId } from '@/lib/seats';

import { ErrorAlert } from './ui/alert';
import { Button } from './ui/button';
import { LoadingBlock, Spinner } from './ui/spinner';
import { TextField } from './ui/text-field';

/**
 * One seat's sign-in panel.
 *
 * There are two of these on the page and they share nothing. Each holds its own
 * token, and every request either of them makes carries *that* seat's token —
 * there is no ambient current user anywhere in this client. Signing in at one
 * seat leaves the other exactly as it was.
 *
 * Both forms are built from the contract's own Zod schemas through
 * `zodResolver`, so the rules the server will apply are the rules the field
 * validates against. Nothing about an email address, a display name or a
 * password length is written down twice.
 */

type Mode = 'sign-in' | 'register';

function fieldId(seat: SeatId, name: string): string {
  return `seat-${seat.toLowerCase()}-${name}`;
}

export function SeatAuthPanel({ seat }: { seat: SeatId }): React.JSX.Element {
  const state = useSeat(seat);
  const { signOut } = useSeatSessions();
  const [mode, setMode] = useState<Mode>('sign-in');
  const headingId = fieldId(seat, 'heading');

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/80 p-5 shadow-xl shadow-black/20 backdrop-blur"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-sm font-bold uppercase tracking-[0.18em] text-accent">
            {SEAT_LABELS[seat]}
          </h2>
          <p className="mt-1 text-xs text-subtle">
            {state.status === 'signed-in'
              ? 'Signed in on this device with its own access token.'
              : 'Each seat signs in separately.'}
          </p>
        </div>

        {state.status === 'signed-in' && (
          <span className="rounded-full border border-active/40 bg-active/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-active">
            Ready
          </span>
        )}
      </div>

      {state.status === 'restoring' && <LoadingBlock label="Restoring this seat’s session…" />}

      {state.status === 'signed-in' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-lg font-semibold text-ink">{state.session.user.displayName}</p>
          <Button
            variant="danger"
            onClick={() => {
              signOut(seat);
            }}
          >
            Sign out
          </Button>
        </div>
      )}

      {state.status === 'signed-out' && (
        <>
          <div
            role="group"
            aria-label={`${SEAT_LABELS[seat]} authentication mode`}
            className="flex gap-1 rounded-lg border border-line bg-canvas/60 p-1"
          >
            <ModeButton current={mode} value="sign-in" onSelect={setMode}>
              Sign in
            </ModeButton>
            <ModeButton current={mode} value="register" onSelect={setMode}>
              Create account
            </ModeButton>
          </div>

          {mode === 'sign-in' ? <SignInForm seat={seat} /> : <RegisterForm seat={seat} />}
        </>
      )}
    </section>
  );
}

function ModeButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: Mode;
  value: Mode;
  onSelect: (mode: Mode) => void;
  children: string;
}): React.JSX.Element {
  const selected = current === value;

  return (
    <Button
      variant="quiet"
      aria-pressed={selected}
      onClick={() => {
        onSelect(value);
      }}
      className={cx(
        'flex-1 py-1.5 text-xs',
        selected ? 'bg-raised text-ink border-line' : 'text-subtle',
      )}
    >
      {children}
    </Button>
  );
}

/** Shared by both forms: hand the session to the seat that asked for it. */
function useAuthMutation<TBody>(
  seat: SeatId,
  send: (body: TBody) => Promise<AuthSession>,
): UseMutationResult<AuthSession, Error, TBody> {
  const { signIn } = useSeatSessions();

  return useMutation<AuthSession, Error, TBody>({
    mutationFn: send,
    onSuccess: (session) => {
      signIn(seat, session);
    },
  });
}

function SignInForm({ seat }: { seat: SeatId }): React.JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useAuthMutation(seat, login);

  const submit = handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={`${SEAT_LABELS[seat]} sign in`}
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
    >
      <TextField
        id={fieldId(seat, 'email')}
        label="Email"
        type="email"
        autoComplete="off"
        placeholder="player@example.com"
        error={errors.email?.message}
        {...register('email')}
      />

      <TextField
        id={fieldId(seat, 'password')}
        label="Password"
        type="password"
        autoComplete="off"
        error={errors.password?.message}
        {...register('password')}
      />

      {mutation.error !== null && <ErrorAlert error={mutation.error} />}

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending && <Spinner />}
        {mutation.isPending ? 'Signing in…' : `Sign in as ${SEAT_LABELS[seat]}`}
      </Button>
    </form>
  );
}

function RegisterForm({ seat }: { seat: SeatId }): React.JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: { email: '', displayName: '', password: '' },
  });

  const mutation = useAuthMutation(seat, registerAccount);

  const submit = handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={`${SEAT_LABELS[seat]} create account`}
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
    >
      <TextField
        id={fieldId(seat, 'register-email')}
        label="Email"
        type="email"
        autoComplete="off"
        placeholder="player@example.com"
        error={errors.email?.message}
        {...register('email')}
      />

      <TextField
        id={fieldId(seat, 'display-name')}
        label="Display name"
        autoComplete="off"
        hint={`${DISPLAY_NAME_MIN_LENGTH}–${DISPLAY_NAME_MAX_LENGTH} characters.`}
        error={errors.displayName?.message}
        {...register('displayName')}
      />

      <TextField
        id={fieldId(seat, 'register-password')}
        label="Password"
        type="password"
        autoComplete="off"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        error={errors.password?.message}
        {...register('password')}
      />

      {mutation.error !== null && <ErrorAlert error={mutation.error} />}

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending && <Spinner />}
        {mutation.isPending ? 'Creating account…' : `Create account for ${SEAT_LABELS[seat]}`}
      </Button>
    </form>
  );
}
