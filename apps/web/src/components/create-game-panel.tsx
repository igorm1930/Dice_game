'use client';

import {
  type CreateGameRequest,
  createGameRequestSchema,
  DEFAULT_WINNING_SCORE,
  type GameView,
  MAX_WINNING_SCORE,
  MIN_WINNING_SCORE,
} from '@dice-game/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { useSeat, useSeatToken } from '@/hooks/seat-sessions';
import { useUsersQuery } from '@/hooks/use-game';
import { createGame } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { SEAT_LABELS } from '@/lib/seats';

import { ErrorAlert } from './ui/alert';
import { Button } from './ui/button';
import { LoadingBlock, Spinner } from './ui/spinner';
import { TextField } from './ui/text-field';

/**
 * Starting a match.
 *
 * Seat A creates it — deliberately fixed rather than offered as a choice, so
 * "who is the creator" is never ambiguous on a page with two identities. The
 * opponent comes from `GET /api/users`, fetched with Seat A's own token, because
 * that endpoint is authenticated and paginated on purpose.
 *
 * The form is `createGameRequestSchema` through `zodResolver`: the winning-score
 * bounds the field enforces are the contract's `MIN_WINNING_SCORE` and
 * `MAX_WINNING_SCORE`, and the server will apply the same schema to the body.
 * The bounds are not written down here.
 */
const CREATOR_SEAT = 'A' as const;

export function CreateGamePanel({
  onCreated,
}: {
  onCreated: (gameId: string) => void;
}): React.JSX.Element {
  const creator = useSeat(CREATOR_SEAT);
  const opponentSeat = useSeat('B');
  const token = useSeatToken(CREATOR_SEAT);
  const users = useUsersQuery(CREATOR_SEAT);
  const queryClient = useQueryClient();

  const creatorId = creator.status === 'signed-in' ? creator.session.user.id : null;
  const suggestedOpponentId =
    opponentSeat.status === 'signed-in' ? opponentSeat.session.user.id : '';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateGameRequest>({
    resolver: zodResolver(createGameRequestSchema),
    defaultValues: { opponentId: suggestedOpponentId, winningScore: DEFAULT_WINNING_SCORE },
  });

  const mutation = useMutation<GameView, Error, CreateGameRequest>({
    mutationFn: (body) => {
      if (token === null) {
        throw new Error('The create-game form submitted with no token for the creating seat.');
      }

      return createGame(token, body);
    },
    onSuccess: (view) => {
      // The response is already this seat's view of the new game; seeding it
      // means the board renders without a second round trip.
      queryClient.setQueryData(queryKeys.game(view.id, CREATOR_SEAT), view);
      onCreated(view.id);
    },
  });

  const submit = handleSubmit((values) => {
    mutation.mutate(values);
  });

  if (creator.status !== 'signed-in') {
    return (
      <section
        aria-labelledby="new-match-heading"
        className="rounded-3xl border border-line bg-surface/60 p-6"
      >
        <h2 id="new-match-heading" className="text-xl font-black tracking-tight text-ink">
          Start a match
        </h2>
        <p className="mt-2 text-sm text-subtle">
          Sign in at {SEAT_LABELS[CREATOR_SEAT]} to start a match. Both seats need their own account
          — that is what makes this two players rather than one.
        </p>
      </section>
    );
  }

  const options = (users.data?.items ?? []).filter((user) => user.id !== creatorId);

  return (
    <section
      aria-labelledby="new-match-heading"
      className="flex flex-col gap-4 rounded-3xl border border-line bg-surface/60 p-6 shadow-2xl shadow-black/30"
    >
      <div>
        <h2 id="new-match-heading" className="text-xl font-black tracking-tight text-ink">
          Start a match
        </h2>
        <p className="mt-1 text-sm text-subtle">
          {SEAT_LABELS[CREATOR_SEAT]} creates the game and picks the opponent.
        </p>
      </div>

      {opponentSeat.status === 'signed-out' && (
        <p className="rounded-lg border border-line bg-raised/50 px-3 py-2 text-xs text-subtle">
          {SEAT_LABELS.B} is signed out. Whoever you pick here will need to sign in at that seat to
          take their turns.
        </p>
      )}

      {users.isPending && <LoadingBlock label="Loading players…" />}

      {users.error !== null && (
        <div className="flex flex-col gap-2">
          <ErrorAlert error={users.error} />
          <Button
            variant="secondary"
            onClick={() => {
              void users.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {users.data !== undefined && (
        <form
          className="flex flex-col gap-4"
          aria-label="Start a match"
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="opponent"
              className="text-xs font-semibold uppercase tracking-wider text-subtle"
            >
              Opponent
            </label>
            <select
              id="opponent"
              aria-invalid={errors.opponentId != null}
              aria-describedby={errors.opponentId != null ? 'opponent-error' : undefined}
              className="w-full rounded-lg border border-line bg-canvas/70 px-3 py-2.5 text-sm text-ink transition hover:border-accent/60 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
              {...register('opponentId')}
            >
              <option value="">Choose a player…</option>
              {options.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
            {errors.opponentId != null && (
              <p id="opponent-error" role="alert" className="text-xs font-medium text-danger">
                Choose an opponent to play against.
              </p>
            )}
          </div>

          <TextField
            id="winning-score"
            label="Winning score"
            type="number"
            inputMode="numeric"
            min={MIN_WINNING_SCORE}
            max={MAX_WINNING_SCORE}
            step={1}
            hint={`Between ${MIN_WINNING_SCORE} and ${MAX_WINNING_SCORE}. Defaults to ${DEFAULT_WINNING_SCORE}.`}
            error={errors.winningScore?.message}
            {...register('winningScore', { valueAsNumber: true })}
          />

          {mutation.error !== null && <ErrorAlert error={mutation.error} />}

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Spinner />}
            {mutation.isPending ? 'Starting…' : 'Start match'}
          </Button>
        </form>
      )}
    </section>
  );
}
