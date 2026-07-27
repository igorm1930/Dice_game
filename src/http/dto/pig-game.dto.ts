/**
 * Pig game wire contracts.
 *
 * There are no request schemas here, and that absence is the point: every rule
 * lives server-side, so the action endpoints accept **no client input at all**.
 * A payload like `{"score": 20}` has nothing to attach to — the validation
 * surface is empty by design, which is a stronger anti-cheat property than any
 * validator. The response contract below is the client's entire vocabulary.
 */
export interface PigGameResponse {
  readonly totalScores: readonly [number, number];
  readonly currentTurnScore: number;
  readonly activePlayer: 0 | 1;
  readonly isPlaying: boolean;
  readonly winner: 0 | 1 | null;
  readonly lastRoll: number | null;
  /** Echoed so the UI can display the win condition without hardcoding it. */
  readonly targetScore: number;
}
