import { useState, type FormEvent } from 'react';

import type { Session } from '../api';

interface AuthPanelProps {
  /** Which chair this panel signs a player into. */
  readonly seat: 0 | 1;
  readonly session: Session | null;
  readonly onAuthenticate: (
    mode: 'login' | 'register',
    username: string,
    password: string,
  ) => Promise<void>;
  readonly onSignOut: () => void;
  readonly disabled: boolean;
}

/**
 * One player's sign-in card.
 *
 * The exercise asks for the two users to be simulated on the same page, so the
 * page holds two of these — two independent credentials, side by side. Each
 * seat's token is stored separately and only ever sent for that seat's actions,
 * which is what makes "player 2 cannot roll on player 1's turn" a real property
 * rather than a disabled button.
 */
export function AuthPanel({ seat, session, onAuthenticate, onSignOut, disabled }: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    void onAuthenticate(mode, username, password).finally(() => {
      setPending(false);
      setPassword('');
    });
  };

  if (session) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/85 px-6 py-5 shadow-lg backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Player {seat + 1}
        </p>
        <p className="text-xl font-bold text-slate-800">{session.player.username}</p>
        <p className="text-xs font-medium text-cyan-700">
          {session.player.wins} {session.player.wins === 1 ? 'win' : 'wins'}
        </p>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-1 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex w-64 flex-col gap-3 rounded-2xl bg-white/85 px-6 py-5 shadow-lg backdrop-blur"
    >
      <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500">
        Player {seat + 1}
      </p>

      <div className="flex rounded-full bg-slate-200/80 p-0.5 text-xs font-semibold uppercase tracking-widest">
        {(['register', 'login'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={`flex-1 rounded-full py-1 transition ${
              mode === option ? 'bg-white text-slate-800 shadow' : 'text-slate-500'
            }`}
          >
            {option === 'register' ? 'Sign up' : 'Log in'}
          </button>
        ))}
      </div>

      <input
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Username"
        autoComplete="username"
        aria-label={`Player ${seat + 1} username`}
        className="rounded-lg bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-cyan-500 focus:ring-2"
      />
      <input
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        placeholder="Password (min 8)"
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        aria-label={`Player ${seat + 1} password`}
        className="rounded-lg bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-cyan-500 focus:ring-2"
      />

      <button
        type="submit"
        disabled={disabled || pending || username === '' || password === ''}
        className="rounded-full bg-cyan-600 px-4 py-2 text-sm font-semibold uppercase tracking-widest text-white shadow transition hover:bg-cyan-500 disabled:opacity-40"
      >
        {mode === 'register' ? 'Sign up' : 'Log in'}
      </button>
    </form>
  );
}
