// Apex Drive's driving model: throttle, brake, steering, damage, the race against the rival
// and the end conditions. Pure numbers only, so scripts/test-games.ts can drive a whole race
// without a GPU. index.ts owns the three.js scene and feeds controls in each frame.

export interface Controls {
  /** -1 full left, +1 full right. Steering input before smoothing. */
  steer: number;
  gas: boolean;
  brake: boolean;
}

export interface DriveEvent {
  type: 'impact' | 'near-miss' | 'corner-damage' | 'finish' | 'wrecked' | 'outrun';
  note?: string;
}

export const TRACK_LENGTH = 2400;
export const LAP_LENGTH = 800;
export const TOP_SPEED = 235;
/** Rival pace in km/h. Beatable, but only if you keep your car in one piece. */
export const RIVAL_SPEED = 174;
export const MAX_X = 6.2;
/** Lateral gap below which a car and an obstacle collide; below NEAR_MISS_X it is a close pass. */
export const COLLISION_X = 1.65;
export const NEAR_MISS_X = 2.7;
export const IMPACT_DAMAGE = 34;

export interface DriveState {
  speed: number;
  /** Smoothed steering, -1..1. */
  steer: number;
  /** Lateral position on the road, clamped to +/-MAX_X. */
  carX: number;
  distance: number;
  rivalDistance: number;
  condition: number;
  nearMiss: number;
  elapsed: number;
  ended: boolean;
}

export function createDriveState(): DriveState {
  return {
    speed: 0, steer: 0, carX: 0,
    distance: 0, rivalDistance: 35,
    condition: 100, nearMiss: 0, elapsed: 0, ended: false,
  };
}

/** The circuit's centre line. Used for both the road mesh and the cornering-damage rule. */
export const trackCurve = (s: number) => 2.2 * Math.sin(s / 110) + 0.9 * Math.sin(s / 57);

/** How sharply the track bends around the car right now. */
export function cornering(distance: number): number {
  return Math.abs(trackCurve(distance + 12) - trackCurve(distance - 12)) / 24;
}

export function score(state: DriveState): number {
  return Math.floor(state.distance / 3 + state.nearMiss * 75);
}

export function lap(state: DriveState): number {
  return Math.min(3, Math.floor(state.distance / LAP_LENGTH) + 1);
}

/**
 * Resolves the car passing an obstacle sitting at lateral position `obstacleX`. A hit scrubs
 * speed and damages the car; a close pass banks a bonus.
 */
export function passObstacle(state: DriveState, obstacleX: number): DriveEvent | null {
  const gap = Math.abs(obstacleX - state.carX);
  if (gap < COLLISION_X) {
    state.speed *= 0.46;
    state.condition = Math.max(0, state.condition - IMPACT_DAMAGE);
    return { type: 'impact' };
  }
  if (gap < NEAR_MISS_X) {
    state.nearMiss += 1;
    return { type: 'near-miss' };
  }
  return null;
}

/** Advances the car by `dt` seconds. Returns anything the renderer should react to. */
export function stepDrive(state: DriveState, dt: number, controls: Controls): DriveEvent[] {
  const events: DriveEvent[] = [];
  if (state.ended) return events;
  state.elapsed += dt;

  state.steer += (controls.steer - state.steer) * Math.min(1, dt * 7.5);
  if (controls.gas) state.speed += 84 * dt;
  else state.speed -= 25 * dt;
  if (controls.brake) state.speed -= 155 * dt;
  state.speed = Math.max(0, Math.min(TOP_SPEED, state.speed));

  // Steering authority grows with speed, so the car feels heavy from a standstill.
  state.carX += state.steer * (3.3 + state.speed / 45) * dt;
  state.carX = Math.max(-MAX_X, Math.min(MAX_X, state.carX));

  state.distance += state.speed * dt / 3.6;
  state.rivalDistance += (RIVAL_SPEED / 3.6) * dt;

  // Taking a bend flat out grinds the car down even without hitting anything.
  if (state.speed > 188 && cornering(state.distance) > 0.026) {
    state.condition = Math.max(0, state.condition - dt * 8);
    events.push({ type: 'corner-damage' });
  }

  if (state.condition <= 0) {
    state.ended = true;
    events.push({ type: 'wrecked', note: 'Three collisions or repeated high-speed cornering wrecked the car.' });
  } else if (state.distance >= TRACK_LENGTH) {
    state.ended = true;
    events.push({ type: 'finish', note: `FINISH FIRST · ${state.elapsed.toFixed(1)} SECONDS.` });
  } else if (state.rivalDistance >= TRACK_LENGTH) {
    state.ended = true;
    events.push({ type: 'outrun', note: 'THE RIVAL FINISHED FIRST. Brake for corners, but keep your speed up.' });
  }
  return events;
}
