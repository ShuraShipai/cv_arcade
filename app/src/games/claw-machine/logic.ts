// Pure claw-machine rules: movement, bounds, the grab sequence and scoring. No THREE, no DOM,
// so the whole game can be driven head-less by scripts/test-games.ts. index.ts owns rendering.

/** The five primary actions. Voice, keyboard and the on-screen pad all funnel into these. */
export type Action = 'up' | 'down' | 'left' | 'right' | 'grab';

/** Where the claw is in the grab sequence. Directions are only read during 'move'. */
export type Phase = 'move' | 'lower' | 'close' | 'lift' | 'return' | 'release' | 'reset';

export interface Prize {
  id: number;
  name: string;
  value: number;
  radius: number;
  /** Colours are passed straight through to the renderer. */
  color: string;
  accent: string;
  x: number;
  z: number;
  y: number;
  held: boolean;
  collected: boolean;
  vy: number;
}

export interface ClawEvent {
  type: 'grab-start' | 'grabbed' | 'missed' | 'scored' | 'no-credits' | 'over';
  prize?: Prize;
  note?: string;
}

/** Cabinet interior in world units. The claw head is clamped to this box. */
export const BOUNDS = { minX: -3.1, maxX: 3.1, minZ: -2.5, maxZ: 2.5 };
export const RAIL_Y = 5.1;
export const FLOOR_Y = 0.35;
export const TRAVEL_Y = RAIL_Y - 1.1;
/** The prize chute, in the front-left corner. */
export const CHUTE = { x: -3.6, z: 2.95 };
export const START_CREDITS = 5;
export const ROUND_SECONDS = 90;
export const MOVE_SPEED = 2.45;
/** Horizontal distance at which the closing claw can reach a prize. */
export const GRAB_RADIUS = 0.78;
/** Fraction of the reach that still produces a secure grip. Outside it the prize slips. */
export const HOLD_FRACTION = 0.72;

export const PRIZE_KINDS = [
  { name: 'PLUSH BEAR', color: '#f2884c', accent: '#ffd9a8', value: 150, radius: 0.52 },
  { name: 'PLUSH BUNNY', color: '#f5c6dd', accent: '#fff2f8', value: 150, radius: 0.5 },
  { name: 'ROBOT TOY', color: '#6fd8ff', accent: '#d8f6ff', value: 220, radius: 0.48 },
  { name: 'STAR PLUSH', color: '#ffe14a', accent: '#fff6c6', value: 260, radius: 0.46 },
  { name: 'GREEN DINO', color: '#7fdc8a', accent: '#dbfbdf', value: 180, radius: 0.54 },
  { name: 'PURPLE CAT', color: '#b88cff', accent: '#ecdfff', value: 200, radius: 0.5 },
];

/** The five words the pretrained speech-commands model maps onto the five actions. */
export const VOICE_WORDS: Record<string, Action> = {
  up: 'up', down: 'down', left: 'left', right: 'right', go: 'grab',
};

/**
 * How confident a spoken match must be before it moves the claw. The Ready-screen mic
 * sensitivity slider (0.5x..2x) drives it, so a quiet mic or a noisy room can be dialled in
 * without a code change: 0.5x is strict, 2x is forgiving.
 */
export function voiceThreshold(sensitivity: number): number {
  return Math.max(0.4, Math.min(0.92, 0.88 - (sensitivity - 0.5) * 0.24));
}

/**
 * Geometry of the hanging claw, shared by the renderer and its tests. The trolley the claw
 * hangs from sits at y = 0 and positions its own parts in world space, so the claw head's
 * offset is simply its world height — subtracting RAIL_Y here buries it under the pit floor.
 */
export function clawRig(y: number) {
  const cableLength = Math.max(0.1, RAIL_Y - y);
  return {
    cableLength,
    /** Mid-point of the cable, so a unit cylinder can be scaled into place. */
    cableCenterY: RAIL_Y - cableLength / 2,
    /** Local offset of the claw head inside the trolley. */
    headY: y,
  };
}

export interface ClawState {
  phase: Phase;
  phaseT: number;
  x: number;
  z: number;
  y: number;
  /** 1 = fingers wide open, 0 = clamped shut. */
  fingerOpen: number;
  credits: number;
  timeLeft: number;
  score: number;
  won: number;
  prizes: Prize[];
  held: Prize | null;
  lastPrize: string;
  ended: boolean;
  /** Widens or narrows the forgiving band; comes from the Ready-screen slider. */
  reachScale: number;
}

/** Directions currently requested this frame. */
export interface Input {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
}

/**
 * Lays out ten prizes in two rows. `jitter` returns 0..1; pass a fixed value (or a seeded
 * generator) to get a repeatable pit for tests.
 */
export function buildPrizes(jitter: () => number = Math.random): Prize[] {
  const prizes: Prize[] = [];
  for (let i = 0; i < 10; i++) {
    const kind = PRIZE_KINDS[i % PRIZE_KINDS.length];
    const col = i % 5, row = Math.floor(i / 5);
    const x = -2.6 + col * 1.3 + (jitter() - 0.5) * 0.34;
    const z = -1.45 + row * 1.9 + (jitter() - 0.5) * 0.34;
    prizes.push({
      id: i, name: kind.name, value: kind.value, radius: kind.radius,
      color: kind.color, accent: kind.accent,
      x, z, y: FLOOR_Y + kind.radius * 0.92,
      held: false, collected: false, vy: 0,
    });
  }
  return prizes;
}

export function createClawState(prizes = buildPrizes()): ClawState {
  return {
    phase: 'move', phaseT: 0,
    x: 0, z: 0, y: TRAVEL_Y, fingerOpen: 1,
    credits: START_CREDITS, timeLeft: ROUND_SECONDS,
    score: 0, won: 0,
    prizes, held: null, lastPrize: 'NONE',
    ended: false, reachScale: 1,
  };
}

/**
 * Deterministic capture rule: the claw reaches the nearest prize within GRAB_RADIUS, and the
 * grip holds only if that prize sits inside HOLD_FRACTION of the reach. Same inputs, same
 * outcome every time — no dice. `reachScale` keeps the difficulty tunable.
 */
export function resolveGrab(state: ClawState): Prize | null {
  let best: Prize | null = null;
  let bestDist = Infinity;
  for (const p of state.prizes) {
    if (p.collected || p.held) continue;
    const dist = Math.hypot(p.x - state.x, p.z - state.z);
    if (dist < bestDist) { bestDist = dist; best = p; }
  }
  if (!best) return null;
  const reach = GRAB_RADIUS * Math.max(0.6, Math.min(1.6, state.reachScale));
  if (bestDist > reach * HOLD_FRACTION) return null;
  return best;
}

/** Starts the grab sequence. Returns the event the caller should announce, or null. */
export function startGrab(state: ClawState): ClawEvent | null {
  if (state.ended || state.phase !== 'move') return null;
  if (state.credits <= 0) return { type: 'no-credits' };
  state.credits -= 1;
  state.phase = 'lower';
  state.phaseT = 0;
  return { type: 'grab-start' };
}

function endRound(state: ClawState, note: string, events: ClawEvent[]) {
  if (state.ended) return;
  state.ended = true;
  events.push({ type: 'over', note });
}

/**
 * Advances the machine by `dt` seconds. Returns everything that happened, so the renderer can
 * play sounds and swap HUD text without re-deriving state.
 */
export function step(state: ClawState, dt: number, input: Input): ClawEvent[] {
  const events: ClawEvent[] = [];
  if (state.ended) return events;
  state.phaseT += dt;
  state.timeLeft = Math.max(0, state.timeLeft - dt);

  if (state.phase === 'move') {
    // UP drives to the back of the cabinet (-Z), DOWN to the front (+Z).
    const dx = Number(!!input.right) - Number(!!input.left);
    const dz = Number(!!input.down) - Number(!!input.up);
    state.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, state.x + dx * MOVE_SPEED * dt));
    state.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, state.z + dz * MOVE_SPEED * dt));
    state.y += (TRAVEL_Y - state.y) * Math.min(1, dt * 7);
    state.fingerOpen += (1 - state.fingerOpen) * Math.min(1, dt * 7);
    // The round can only end between grabs, so a paid attempt always plays out.
    if (state.timeLeft <= 0) endRound(state, `Time is up. You won ${state.won} prize${state.won === 1 ? '' : 's'}.`, events);
    else if (state.credits <= 0) endRound(state, `Out of credits. You won ${state.won} prize${state.won === 1 ? '' : 's'}.`, events);
  } else if (state.phase === 'lower') {
    state.y -= 3.1 * dt;
    if (state.y <= FLOOR_Y + 0.72) { state.y = FLOOR_Y + 0.72; state.phase = 'close'; state.phaseT = 0; }
  } else if (state.phase === 'close') {
    state.fingerOpen = Math.max(0, state.fingerOpen - dt * 2.4);
    if (state.phaseT >= 0.5) {
      const caught = resolveGrab(state);
      if (caught) {
        caught.held = true;
        state.held = caught;
        events.push({ type: 'grabbed', prize: caught });
      } else {
        events.push({ type: 'missed' });
      }
      state.phase = 'lift';
      state.phaseT = 0;
    }
  } else if (state.phase === 'lift') {
    state.y += 2.5 * dt;
    if (state.y >= TRAVEL_Y) { state.y = TRAVEL_Y; state.phase = 'return'; state.phaseT = 0; }
  } else if (state.phase === 'return') {
    if (state.held) {
      state.x += Math.max(-1, Math.min(1, CHUTE.x - state.x)) * 3.4 * dt;
      state.z += Math.max(-1, Math.min(1, CHUTE.z - state.z)) * 3.4 * dt;
      if (Math.hypot(CHUTE.x - state.x, CHUTE.z - state.z) < 0.12) {
        state.x = CHUTE.x; state.z = CHUTE.z; state.phase = 'release'; state.phaseT = 0;
      }
    } else {
      state.phase = 'reset';
      state.phaseT = 0;
    }
  } else if (state.phase === 'release') {
    state.fingerOpen = Math.min(1, state.fingerOpen + dt * 3);
    if (state.phaseT >= 0.35 && state.held) {
      const prize = state.held;
      prize.held = false;
      prize.collected = true;
      prize.vy = 0;
      state.won += 1;
      state.score += prize.value;
      state.lastPrize = prize.name;
      state.held = null;
      events.push({ type: 'scored', prize });
      state.phase = 'reset';
      state.phaseT = 0;
    }
  } else if (state.phase === 'reset') {
    state.fingerOpen = Math.min(1, state.fingerOpen + dt * 3);
    if (state.phaseT >= 0.3) {
      state.phase = 'move';
      state.phaseT = 0;
      if (state.credits <= 0) endRound(state, `Out of credits. You won ${state.won} prize${state.won === 1 ? '' : 's'}.`, events);
      else if (state.timeLeft <= 0) endRound(state, `Time is up. You won ${state.won} prize${state.won === 1 ? '' : 's'}.`, events);
      else if (state.prizes.every((p) => p.collected)) endRound(state, 'Cabinet cleared! Every prize is yours.', events);
    }
  }

  // A held prize rides under the claw; a collected one falls into the chute tray.
  for (const p of state.prizes) {
    if (p.held) {
      p.x = state.x;
      p.z = state.z;
      p.y = state.y - 0.55 - p.radius;
    } else if (p.collected) {
      const restY = FLOOR_Y - 0.1 + p.radius * 0.8;
      if (p.y > restY) {
        p.vy -= 12 * dt;
        p.y = Math.max(restY, p.y + p.vy * dt);
        if (p.y <= restY) p.vy = 0;
      }
      p.x += (CHUTE.x - p.x) * Math.min(1, dt * 4);
      p.z += (CHUTE.z - p.z) * Math.min(1, dt * 4);
    }
  }
  return events;
}
