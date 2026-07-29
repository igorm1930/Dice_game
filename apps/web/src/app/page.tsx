'use client';

import { useEffect, useRef, useState } from 'react';

import { CreateGamePanel } from '@/components/create-game-panel';
import { GameBoard } from '@/components/game-board';
import { SeatAuthPanel } from '@/components/seat-auth-panel';
import { useFocusOnChange } from '@/hooks/use-focus-on-change';
import { SEAT_IDS } from '@/lib/seats';
import { readActiveGameId, writeActiveGameId } from '@/lib/session-storage';

/**
 * The whole client, on one page.
 *
 * Two seats sign in independently at the top; below them is either the
 * match-creation form or the board. The chosen match id is kept in
 * `sessionStorage` alongside the two tokens, so a refresh returns to the game
 * rather than to an empty lobby.
 *
 * It is read in an effect rather than during render: `sessionStorage` does not
 * exist on the server, and reading it while rendering would make the server's
 * HTML and the browser's first render disagree.
 */
export default function HomePage(): React.JSX.Element {
  const [gameId, setGameId] = useState<string | null>(null);

  useEffect(() => {
    setGameId(readActiveGameId());
  }, []);

  // `<main>` is the skip link's target and the landing place for a keyboard
  // user after the branch below it is swapped out from under them, so it has to
  // be programmatically focusable. It is `tabIndex={-1}`, not `0`: a target, not
  // a tab stop.
  const matchRef = useRef<HTMLElement>(null);

  useFocusOnChange(gameId === null ? 'lobby' : 'board', matchRef);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">Dice Game</h1>
        <p className="max-w-2xl text-sm text-subtle">
          Two authenticated players share this page, each with their own access token. Every roll,
          every score and every enabled button comes from the server — this client renders the
          answer and sends the next command.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {SEAT_IDS.map((seat) => (
          <SeatAuthPanel key={seat} seat={seat} />
        ))}
      </div>

      <main id="match" ref={matchRef} tabIndex={-1} className="flex flex-col gap-6">
        {gameId === null ? (
          <CreateGamePanel
            onCreated={(id) => {
              writeActiveGameId(id);
              setGameId(id);
            }}
          />
        ) : (
          <GameBoard
            gameId={gameId}
            onLeave={() => {
              writeActiveGameId(null);
              setGameId(null);
            }}
          />
        )}
      </main>

      <footer className="pb-4 text-xs text-subtle">
        Rules, dice and turn order are decided by the API. This page holds no game logic.
      </footer>
    </div>
  );
}
