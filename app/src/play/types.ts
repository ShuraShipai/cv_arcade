import type { Game } from '../games';
import type { HandState } from '../input/hand';
import type { Keys } from '../input/keys';
import type { MicMeter } from '../input/mic';
import type { Sound } from '../lib/sound';

/** What the game page hands to a game. */
export interface GameContext {
  game: Game;
  /** 16:9 letterboxed box. Put your canvas (or DOM) in it. */
  view: HTMLElement;
  keys: Keys;
  /** Live hand state, or null when playing with the keyboard or the game needs no camera. */
  hand: HandState | null;
  /** Mic meter, or null when playing with the keyboard or the game needs no mic. */
  mic: MicMeter | null;
  /**
   * True when the player granted the microphone for this run. Games with `ownsMicInput` get
   * this instead of `mic`: the page holds no stream, so the game's own recognizer can.
   */
  micGranted: boolean;
  settings: { sensitivity: number };
  debug: boolean;
  sound: Sound;
  reducedMotion: boolean;
  /** Updates the score in the HUD. */
  setScore(score: number): void;
  /** Short extra HUD text next to the score, e.g. "COINS 4". */
  setInfo(text: string): void;
  /** Ends the run and shows the Game over screen. */
  gameOver(score: number, note?: string): void;
}

export interface GameInstance {
  /** Called every frame while playing. dt in seconds, capped at 0.05. */
  update(dt: number): void;
  pause?(): void;
  resume?(): void;
  destroy(): void;
}

export interface GameModule {
  create(ctx: GameContext): GameInstance | Promise<GameInstance>;
  /** Set false for games that run their own intro (the quiz deck picker). Default true. */
  countdown?: boolean;
}
