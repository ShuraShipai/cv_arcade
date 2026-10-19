// npm test: head-less checks for the arcade cabinet and the Claw Machine rules.
// Runs on tsx with no test framework, so it works without extra dependencies.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMES } from '../app/src/games';
import { GAME_LOADERS } from '../app/src/games/registry';
import {
  COLLISION_X, IMPACT_DAMAGE, NEAR_MISS_X, RIVAL_SPEED, TOP_SPEED, TRACK_LENGTH,
  cornering, createDriveState, lap as lapOf, passObstacle, score as scoreOf, stepDrive,
  type Controls, type DriveState,
} from '../app/src/games/apex-drive/physics';
import {
  BOUNDS, CHUTE, FLOOR_Y, GRAB_RADIUS, HOLD_FRACTION, MOVE_SPEED, ROUND_SECONDS,
  RAIL_Y, START_CREDITS, TRAVEL_Y, VOICE_WORDS, buildPrizes, createClawState, resolveGrab, startGrab,
  clawRig, step, voiceThreshold,
  type ClawState, type Input, type Prize,
} from '../app/src/games/claw-machine/logic';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Road half-width: the car is clamped to +/-MAX_ROAD. */
const MAX_ROAD = 6.2;
let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${error instanceof Error ? error.message : error}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function near(a: number, b: number, tol: number, msg: string) {
  assert(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ~${b})`);
}

/** Runs the machine for `seconds`, holding `input`, and collects every event. */
function run(state: ClawState, seconds: number, input: Input = {}) {
  const events = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) events.push(...step(state, dt, input));
  return events;
}
/** A repeatable pit: prizes exactly on the grid, no jitter. */
const fixedPit = () => buildPrizes(() => 0.5);
/** Drives one full grab sequence to completion and returns the events. */
function fullGrab(state: ClawState) {
  const before = state.phase;
  assert(before === 'move', 'grab must start from the move phase');
  startGrab(state);
  const events = [];
  const dt = 1 / 60;
  for (let i = 0; i < 2400 && state.phase !== 'move' && !state.ended; i++) {
    events.push(...step(state, dt, {}));
  }
  return events;
}

/** Like fullGrab but assumes the sequence has already been started. */
function finishGrab(state: ClawState) {
  const events = [];
  const dt = 1 / 60;
  for (let i = 0; i < 2400 && state.phase !== 'move' && !state.ended; i++) events.push(...step(state, dt, {}));
  if (!state.ended) events.push(...step(state, dt, {}));
  return events;
}

console.log('\nArcade cabinet');

check('every game in games.ts has a loader and a folder', () => {
  for (const game of GAMES) {
    assert(GAME_LOADERS[game.slug], `no loader for ${game.slug}`);
    assert(existsSync(join(root, 'knowledge', `${game.slug}.md`)), `no knowledge file for ${game.slug}`);
  }
});

check('every loader maps to a listed game (no orphan routes)', () => {
  for (const slug of Object.keys(GAME_LOADERS)) {
    assert(GAMES.some((g) => g.slug === slug), `loader ${slug} is not in games.ts`);
  }
});

check('the monkey game is gone from the cabinet', () => {
  assert(!GAMES.some((g) => g.slug === 'jungle-safari'), 'jungle-safari is still listed');
  assert(!GAME_LOADERS['jungle-safari'], 'jungle-safari still has a loader');
  assert(!existsSync(join(root, 'app/src/games/jungle-safari')), 'jungle-safari folder still exists');
  assert(!existsSync(join(root, 'knowledge/jungle-safari.md')), 'jungle-safari knowledge file still exists');
});

check('the unrelated games are still in the cabinet', () => {
  for (const slug of ['rail-rush', 'hill-climb', 'rps', 'scream-chicken', 'quiz-battle']) {
    assert(GAMES.some((g) => g.slug === slug), `${slug} disappeared`);
    assert(GAME_LOADERS[slug], `${slug} lost its loader`);
  }
});

check('Car Racing and Claw Machine are both listed', () => {
  const apex = GAMES.find((g) => g.slug === 'apex-drive');
  const claw = GAMES.find((g) => g.slug === 'claw-machine');
  assert(apex, 'apex-drive missing');
  assert(claw, 'claw-machine missing');
  assert(apex!.input === 'hand' && apex!.needs === 'camera', 'apex-drive should be a camera game');
  assert(claw!.input === 'voice' && claw!.needs === 'mic', 'claw-machine should be a voice game');
});

check('Claw Machine took the monkey game\'s slot in the list', () => {
  assert(GAMES[5].slug === 'claw-machine', `expected claw-machine at index 5, found ${GAMES[5].slug}`);
  assert(GAMES[4].slug === 'scream-chicken' && GAMES[6].slug === 'quiz-battle', 'neighbours moved');
});

check('Claw Machine documents all five controls', () => {
  const text = GAMES.find((g) => g.slug === 'claw-machine')!.controls.join(' ').toLowerCase();
  for (const word of ['left', 'right', 'up', 'down', 'go', 'space', 'grab']) {
    assert(text.includes(word), `controls never mention "${word}"`);
  }
});

console.log('\nApex Drive · driving');

/** Drives for `seconds` holding `controls`, returning every event. */
function drive(state: DriveState, seconds: number, controls: Partial<Controls> = {}) {
  const events = [];
  const dt = 1 / 60;
  const full: Controls = { steer: 0, gas: false, brake: false, ...controls };
  for (let t = 0; t < seconds; t += dt) events.push(...stepDrive(state, dt, full));
  return events;
}

check('the accelerator builds speed and lifting off coasts it down', () => {
  const s = createDriveState();
  assert(s.speed === 0, 'the car starts stopped');
  drive(s, 2, { gas: true });
  assert(s.speed > 100, `two seconds of throttle should pass 100 km/h, got ${s.speed}`);
  const topped = s.speed;
  drive(s, 2);
  assert(s.speed < topped, 'lifting off the throttle should slow the car');
});

check('the brake slows the car harder than coasting', () => {
  const coast = createDriveState();
  const braked = createDriveState();
  drive(coast, 2, { gas: true });
  drive(braked, 2, { gas: true });
  const entry = coast.speed;
  drive(coast, 1);
  drive(braked, 1, { brake: true });
  assert(braked.speed < coast.speed, 'braking should beat coasting');
  assert(entry - braked.speed > 100, `the brake should scrub real speed, lost ${entry - braked.speed}`);
});

check('speed is clamped between a standstill and the top speed', () => {
  const s = createDriveState();
  // Keep the race from finishing or the car from wrecking, so the speed clamp is all that
  // decides the outcome here. Those end conditions have their own checks.
  const holdRaceOpen = () => { s.distance = 0; s.rivalDistance = 0; s.condition = 100; };
  for (let i = 0; i < 40; i++) { drive(s, 1, { gas: true }); holdRaceOpen(); }
  near(s.speed, TOP_SPEED, 1e-9, `speed should cap at ${TOP_SPEED}`);
  for (let i = 0; i < 30; i++) { drive(s, 1, { brake: true }); holdRaceOpen(); }
  assert(s.speed === 0, `the car should stop at zero, got ${s.speed}`);
  assert(!s.ended, 'the car should still be racing');
});

check('steering moves the car both ways and is clamped to the road', () => {
  const s = createDriveState();
  drive(s, 2, { gas: true });
  drive(s, 1.5, { gas: true, steer: 1 });
  assert(s.carX > 0.5, `steering right should move the car right, got ${s.carX}`);
  const right = s.carX;
  drive(s, 3, { gas: true, steer: -1 });
  assert(s.carX < right, 'steering left should bring the car back');
  drive(s, 20, { gas: true, steer: -1 });
  assert(s.carX >= -MAX_ROAD - 1e-9 && s.carX <= MAX_ROAD + 1e-9, `car left the road at ${s.carX}`);
  drive(s, 20, { gas: true, steer: 1 });
  assert(s.carX <= MAX_ROAD + 1e-9, `car left the road at ${s.carX}`);
});

check('the car does not drift sideways with no steering input', () => {
  const s = createDriveState();
  drive(s, 5, { gas: true });
  near(s.carX, 0, 1e-9, 'a straight car should hold its line');
});

check('distance and score only grow while the car is moving', () => {
  const s = createDriveState();
  drive(s, 3);
  near(s.distance, 0, 1e-9, 'a stopped car covers no ground');
  assert(scoreOf(s) === 0, 'a stopped car scores nothing');
  drive(s, 5, { gas: true });
  assert(s.distance > 0, 'driving should cover ground');
  assert(scoreOf(s) > 0, 'distance should score');
});

check('laps advance with distance', () => {
  const s = createDriveState();
  assert(lapOf(s) === 1, 'the race starts on lap 1');
  s.distance = 1200;
  assert(lapOf(s) === 2, 'lap 2 by 1200 m');
  s.distance = TRACK_LENGTH;
  assert(lapOf(s) === 3, 'the last lap is capped at 3');
});

check('hitting an obstacle damages the car and scrubs speed', () => {
  const s = createDriveState();
  drive(s, 3, { gas: true });
  const before = s.speed;
  const event = passObstacle(s, s.carX);
  assert(event?.type === 'impact', 'a head-on obstacle should be an impact');
  assert(s.speed < before * 0.6, `an impact should scrub speed, ${before} -> ${s.speed}`);
  assert(s.condition === 100 - IMPACT_DAMAGE, `condition should drop to ${100 - IMPACT_DAMAGE}, got ${s.condition}`);
});

check('a close pass scores a bonus instead of a hit', () => {
  const s = createDriveState();
  drive(s, 3, { gas: true });
  const event = passObstacle(s, s.carX + (COLLISION_X + NEAR_MISS_X) / 2);
  assert(event?.type === 'near-miss', 'a near pass should be a near miss');
  assert(s.condition === 100, 'a near miss should not damage the car');
  assert(s.nearMiss === 1, 'the near miss should be banked');
  assert(scoreOf(s) > Math.floor(s.distance / 3), 'the near miss should add points');
});

check('a wide pass is neither a hit nor a bonus', () => {
  const s = createDriveState();
  drive(s, 3, { gas: true });
  assert(passObstacle(s, s.carX + NEAR_MISS_X + 0.5) === null, 'a wide pass should do nothing');
  assert(s.condition === 100 && s.nearMiss === 0, 'a wide pass should change nothing');
});

check('three impacts wreck the car and end the race', () => {
  const s = createDriveState();
  drive(s, 3, { gas: true });
  passObstacle(s, s.carX);
  passObstacle(s, s.carX);
  assert(!s.ended, 'two impacts should be survivable');
  passObstacle(s, s.carX);
  const events = drive(s, 0.1, { gas: true });
  const over = events.find((e) => e.type === 'wrecked');
  assert(over, 'the third impact should wreck the car');
  assert(s.ended, 'the race should be over');
  assert(over!.note?.includes('wrecked'), `unexpected note: ${over!.note}`);
});

check('finishing the track first wins the race', () => {
  const s = createDriveState();
  s.distance = TRACK_LENGTH - 1;
  const events = drive(s, 1, { gas: true });
  const over = events.find((e) => e.type === 'finish');
  assert(over, 'crossing the line should finish the race');
  assert(over!.note?.includes('FINISH FIRST'), `unexpected note: ${over!.note}`);
});

check('the rival wins if it reaches the line first', () => {
  const s = createDriveState();
  s.rivalDistance = TRACK_LENGTH - 1;
  const events = drive(s, 1);
  const over = events.find((e) => e.type === 'outrun');
  assert(over, 'the rival should be able to win');
  assert(s.ended, 'the race should be over');
});

check('the rival runs at its stated pace', () => {
  const s = createDriveState();
  const start = s.rivalDistance;
  drive(s, 10);
  near(s.rivalDistance - start, (RIVAL_SPEED / 3.6) * 10, 1, 'the rival should hold RIVAL_SPEED');
});

check('the circuit has real bends and real straights', () => {
  let bend = 0, straight = 0;
  for (let d = 0; d < TRACK_LENGTH; d += 5) (cornering(d) > 0.026 ? bend++ : straight++);
  assert(bend > 20, `the track should have bends to brake for, found ${bend} samples`);
  assert(straight > bend, 'the track should still be mostly straight');
});

check('flat-out cornering wears the car down', () => {
  const s = createDriveState();
  drive(s, 20, { gas: true });
  assert(s.speed > 188, 'the car should be past the cornering threshold');
  const before = s.condition;
  // Drop the car onto the sharpest bend on the circuit and hold the throttle open.
  s.distance = 0;
  const events = drive(s, 0.2, { gas: true });
  assert(events.some((e) => e.type === 'corner-damage'), 'a flat-out bend should report damage');
  assert(s.condition < before, 'a flat-out bend should wear the car');
});

check('braking for the bends protects the car over a full race', () => {
  const flat = createDriveState();
  const careful = createDriveState();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 120 && !flat.ended; i++) stepDrive(flat, dt, { steer: 0, gas: true, brake: false });
  // The careful driver lifts off whenever the bend ahead is sharp.
  for (let i = 0; i < 60 * 120 && !careful.ended; i++) {
    const sharp = cornering(careful.distance) > 0.026 && careful.speed > 180;
    stepDrive(careful, dt, { steer: 0, gas: !sharp, brake: sharp });
  }
  assert(flat.condition < 100, 'driving flat out should cost condition');
  assert(careful.condition > flat.condition, `braking should preserve the car (${careful.condition} vs ${flat.condition})`);
});

check('a finished race ignores further driving', () => {
  const s = createDriveState();
  s.distance = TRACK_LENGTH;
  drive(s, 0.1, { gas: true });
  assert(s.ended, 'the race should be over');
  const distance = s.distance, speed = s.speed;
  drive(s, 2, { gas: true, steer: 1 });
  near(s.distance, distance, 1e-9, 'a finished race must not keep moving');
  near(s.speed, speed, 1e-9, 'a finished race must not keep accelerating');
});

check('restart gives a fresh car', () => {
  const s = createDriveState();
  drive(s, 5, { gas: true });
  passObstacle(s, s.carX);
  const fresh = createDriveState();
  assert(fresh.speed === 0 && fresh.distance === 0, 'a new race starts stopped at the line');
  assert(fresh.condition === 100, 'a new race restores the car');
  assert(fresh.carX === 0 && fresh.steer === 0 && !fresh.ended, 'a new race is clean');
  assert(scoreOf(fresh) === 0, 'a new race scores zero');
});

console.log('\nClaw Machine · the five controls');

check('LEFT and RIGHT move the claw on X only', () => {
  const s = createClawState(fixedPit());
  run(s, 0.5, { right: true });
  assert(s.x > 0.5, `right should increase x, got ${s.x}`);
  near(s.z, 0, 1e-6, 'right must not change z');
  const xAfterRight = s.x;
  run(s, 0.5, { left: true });
  assert(s.x < xAfterRight, 'left should decrease x');
});

check('UP moves to the back (-Z) and DOWN to the front (+Z)', () => {
  const s = createClawState(fixedPit());
  run(s, 0.5, { up: true });
  assert(s.z < -0.5, `up should move towards the back, got z=${s.z}`);
  near(s.x, 0, 1e-6, 'up must not change x');
  run(s, 1.0, { down: true });
  assert(s.z > 0, `down should move towards the front, got z=${s.z}`);
});

check('GRAB spends a credit and starts the sequence', () => {
  const s = createClawState(fixedPit());
  const event = startGrab(s);
  assert(event?.type === 'grab-start', 'grab should start');
  assert(s.credits === START_CREDITS - 1, `credits should drop to ${START_CREDITS - 1}, got ${s.credits}`);
  assert(s.phase === 'lower', `phase should be lower, got ${s.phase}`);
});

check('GRAB is ignored while a grab is already running', () => {
  const s = createClawState(fixedPit());
  startGrab(s);
  const second = startGrab(s);
  assert(second === null, 'a second grab mid-sequence must be refused');
  assert(s.credits === START_CREDITS - 1, 'a refused grab must not cost a credit');
});

check('directions are ignored once the claw is descending', () => {
  const s = createClawState(fixedPit());
  startGrab(s);
  const x = s.x, z = s.z;
  run(s, 0.2, { left: true, up: true });
  near(s.x, x, 1e-9, 'x must not move during lower');
  near(s.z, z, 1e-9, 'z must not move during lower');
});

console.log('\nClaw Machine · movement limits');

check('the claw is clamped inside the cabinet on every axis', () => {
  const s = createClawState(fixedPit());
  run(s, 12, { right: true, down: true });
  near(s.x, BOUNDS.maxX, 1e-6, 'x should clamp to maxX');
  near(s.z, BOUNDS.maxZ, 1e-6, 'z should clamp to maxZ');
  run(s, 12, { left: true, up: true });
  near(s.x, BOUNDS.minX, 1e-6, 'x should clamp to minX');
  near(s.z, BOUNDS.minZ, 1e-6, 'z should clamp to minZ');
});

check('travel speed matches MOVE_SPEED', () => {
  const s = createClawState(fixedPit());
  run(s, 1, { right: true });
  near(s.x, MOVE_SPEED, 0.05, 'one second of travel should cover MOVE_SPEED units');
});

console.log('\nClaw Machine · lowering, lifting and capture');

check('the claw visibly lowers to the pit and lifts back to the rail', () => {
  const s = createClawState(fixedPit());
  startGrab(s);
  let lowest = s.y;
  const dt = 1 / 60;
  while (s.phase === 'lower' || s.phase === 'close') { step(s, dt, {}); lowest = Math.min(lowest, s.y); }
  assert(lowest < FLOOR_Y + 1.1, `claw should reach the pit floor, lowest y=${lowest}`);
  assert(TRAVEL_Y - lowest > 2.5, 'the drop should be a visible travel, not a nudge');
  while (s.phase === 'lift') step(s, dt, {});
  near(s.y, TRAVEL_Y, 1e-6, 'the claw should return to rail height');
});

check('a centred grab captures the prize (deterministic)', () => {
  const s = createClawState(fixedPit());
  const target = s.prizes[2];
  s.x = target.x;
  s.z = target.z;
  assert(resolveGrab(s)?.id === target.id, 'a dead-centre claw should resolve to the prize below it');
  startGrab(s);
  const dt = 1 / 60;
  while (s.phase === 'lower' || s.phase === 'close') step(s, dt, {});
  assert(s.held?.id === target.id, 'the prize should be held after closing');
});

check('an off-centre grab comes up empty (deterministic)', () => {
  const s = createClawState(fixedPit());
  const target = s.prizes[2];
  // Just outside the holding band but inside the raw reach: a near miss, every time.
  s.x = target.x + GRAB_RADIUS * HOLD_FRACTION + 0.02;
  s.z = target.z;
  assert(resolveGrab(s) === null, 'an edge grab must not stick');
  const events = fullGrab(s);
  assert(events.some((e) => e.type === 'missed'), 'a missed grab should report "missed"');
  assert(s.held === null, 'nothing should be held after a miss');
  assert(s.prizes.every((p) => !p.collected), 'a miss must not score a prize');
});

check('the same grab gives the same result every time', () => {
  const results = [0, 1, 2].map(() => {
    const s = createClawState(fixedPit());
    s.x = s.prizes[4].x;
    s.z = s.prizes[4].z;
    fullGrab(s);
    return s.score;
  });
  assert(new Set(results).size === 1, `capture should be deterministic, got ${results.join(', ')}`);
  assert(results[0] > 0, 'a centred grab should score');
});

check('a captured prize travels with the claw while it lifts and carries', () => {
  const s = createClawState(fixedPit());
  const target = s.prizes[2];
  s.x = target.x;
  s.z = target.z;
  startGrab(s);
  const dt = 1 / 60;
  while (s.phase !== 'lift') step(s, dt, {});
  const startY = target.y;
  const carryStartX = s.x;
  let sawRise = false, sawCarry = false;
  // Follow the prize through the lift AND the horizontal run to the chute: if it ever
  // stops tracking the claw head, one of these assertions fires.
  while (s.phase === 'lift' || s.phase === 'return') {
    step(s, dt, {});
    near(target.x, s.x, 1e-6, 'the prize should stay under the claw in x');
    near(target.z, s.z, 1e-6, 'the prize should stay under the claw in z');
    near(target.y, s.y - 0.55 - target.radius, 1e-6, 'the prize should hang below the claw');
    if (target.y > startY + 0.5) sawRise = true;
    if (Math.abs(target.x - carryStartX) > 0.5) sawCarry = true;
  }
  assert(sawRise, 'the held prize should rise with the claw');
  assert(sawCarry, 'the held prize should travel sideways towards the chute');
});

check('a held prize is carried to the chute, released and scored', () => {
  const s = createClawState(fixedPit());
  const target = s.prizes[2];
  s.x = target.x;
  s.z = target.z;
  const events = fullGrab(s);
  assert(events.some((e) => e.type === 'grabbed'), 'should report a capture');
  const scored = events.find((e) => e.type === 'scored');
  assert(scored, 'should report a score');
  assert(scored!.prize!.id === target.id, 'the scored prize should be the captured one');
  assert(s.score === target.value, `score should be ${target.value}, got ${s.score}`);
  assert(s.won === 1, 'the prize counter should read 1');
  assert(target.collected && !target.held, 'the prize should be collected, not held');
  near(s.x, CHUTE.x, 0.2, 'the claw should have travelled to the chute');
  near(s.z, CHUTE.z, 0.2, 'the claw should have travelled to the chute');
});

check('a collected prize settles into the chute tray', () => {
  const s = createClawState(fixedPit());
  const target = s.prizes[2];
  s.x = target.x;
  s.z = target.z;
  fullGrab(s);
  run(s, 2);
  near(target.x, CHUTE.x, 0.1, 'the prize should settle at the chute');
  near(target.z, CHUTE.z, 0.1, 'the prize should settle at the chute');
  assert(target.y < FLOOR_Y + 0.6, `the prize should drop into the tray, y=${target.y}`);
});

check('a collected prize cannot be grabbed again', () => {
  const s = createClawState(fixedPit());
  const target = s.prizes[2];
  s.x = target.x;
  s.z = target.z;
  fullGrab(s);
  s.x = target.x;
  s.z = target.z;
  const again = resolveGrab(s);
  assert(again?.id !== target.id, 'a collected prize must not be grabbable again');
});

console.log('\nBundle health');

check('the browser bundle never reaches for Node\'s process', () => {
  // Regression: speech-commands imports `util`, and the npm polyfill reads
  // process.env.NODE_DEBUG as it initialises, throwing "process is not defined" and taking
  // the voice model down with it.
  const dist = join(root, 'dist/assets');
  if (!existsSync(dist)) {
    console.log('       (skipped: run npm run build first)');
    return;
  }
  const offenders: string[] = [];
  for (const file of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(join(dist, file), 'utf8');
    if (/process\.env/.test(code) || /NODE_DEBUG/.test(code)) offenders.push(file);
  }
  assert(offenders.length === 0, `chunks reference Node globals: ${offenders.join(', ')}`);
});

check('util resolves to the local shim, not the npm polyfill', () => {
  const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  assert(/find:\s*\/\^util\$\//.test(config), 'vite should alias the bare `util` import');
  assert(config.includes('node-util-shim'), 'the alias should point at the local shim');
  const shim = join(root, 'app/src/lib/node-util-shim.ts');
  assert(existsSync(shim), 'the shim file should exist');
  assert(readFileSync(shim, 'utf8').includes('export function promisify'),
    'the shim must provide the one export speech-commands imports');
});

check('the util polyfill is not a dependency any more', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert(!pkg.dependencies?.util, 'the `util` polyfill should no longer be installed');
});

console.log('\nClaw Machine · rig geometry');

check('the claw head hangs at its own world height, not an offset', () => {
  // Regression: the head was placed at y - RAIL_Y while its parent sat at y = 0, which
  // buried the claw under the pit floor and left the cable dangling empty.
  for (const y of [TRAVEL_Y, FLOOR_Y + 0.72, RAIL_Y, 2.5]) {
    near(clawRig(y).headY, y, 1e-9, `the head should sit at y=${y}`);
  }
});

check('the claw head is always inside the cabinet', () => {
  const s = createClawState(fixedPit());
  s.x = s.prizes[2].x;
  s.z = s.prizes[2].z;
  startGrab(s);
  const dt = 1 / 60;
  for (let i = 0; i < 2400 && s.phase !== 'move'; i++) {
    step(s, dt, {});
    const { headY } = clawRig(s.y);
    assert(headY > FLOOR_Y - 0.5, `the claw head sank below the pit floor to ${headY}`);
    assert(headY <= RAIL_Y + 1e-9, `the claw head rose above the rail to ${headY}`);
  }
});

check('the cable always spans the rail down to the claw head', () => {
  for (const y of [TRAVEL_Y, FLOOR_Y + 0.72, 3.0, RAIL_Y]) {
    const { cableLength, cableCenterY, headY } = clawRig(y);
    const top = cableCenterY + cableLength / 2;
    const bottom = cableCenterY - cableLength / 2;
    near(top, RAIL_Y, 1e-9, 'the cable should start at the rail');
    assert(bottom <= headY + 1e-9, `the cable should reach the head (bottom ${bottom}, head ${headY})`);
    assert(cableLength > 0, 'the cable should never collapse to nothing');
  }
});

check('lowering lengthens the cable, lifting shortens it', () => {
  assert(clawRig(FLOOR_Y + 0.72).cableLength > clawRig(TRAVEL_Y).cableLength,
    'a lowered claw should hang on more cable than a raised one');
});

console.log('\nClaw Machine · bundled model');

check('the pretrained model is served by this app, not a third-party CDN', () => {
  const source = readFileSync(join(root, 'app/src/games/claw-machine/index.ts'), 'utf8');
  // Strip comments: the CDN is named in a note explaining why we stopped using it.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert(!code.includes('storage.googleapis.com'), 'the game should not fetch the model from a CDN');
  assert(code.includes('/models/speech-commands/18w'), 'the game should load the vendored model');
});

check('every file the model manifest needs is present and complete', () => {
  const dir = join(root, 'app/public/models/speech-commands/18w');
  const manifest = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'));
  const bytes = { float32: 4, int32: 4, uint8: 1, bool: 1, float16: 2 } as Record<string, number>;
  let declared = 0;
  for (const group of manifest.weightsManifest) {
    for (const weight of group.weights) {
      declared += weight.shape.reduce((a: number, b: number) => a * b, 1) * bytes[weight.dtype];
    }
    for (const path of group.paths) {
      assert(existsSync(join(dir, path)), `weight shard ${path} is missing`);
    }
  }
  const onDisk = manifest.weightsManifest
    .flatMap((g: { paths: string[] }) => g.paths)
    .reduce((sum: number, p: string) => sum + statSync(join(dir, p)).size, 0);
  assert(declared === onDisk, `weights are truncated: manifest wants ${declared} bytes, found ${onDisk}`);
});

check('the bundled metadata carries the five words we act on', () => {
  const dir = join(root, 'app/public/models/speech-commands/18w');
  const words: string[] = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8')).words;
  for (const word of Object.keys(VOICE_WORDS)) {
    assert(words.includes(word), `the bundled model cannot recognise "${word}"`);
  }
});

console.log('\nClaw Machine · voice mapping');

check('the five spoken words map onto the five actions', () => {
  assert(VOICE_WORDS.left === 'left' && VOICE_WORDS.right === 'right', 'left/right should map');
  assert(VOICE_WORDS.up === 'up' && VOICE_WORDS.down === 'down', 'up/down should map');
  assert(VOICE_WORDS.go === 'grab', '"go" should be the GRAB word');
  assert(Object.keys(VOICE_WORDS).length === 5, 'exactly five words should be acted on');
});

check('every mapped word exists in the pretrained 18w vocabulary', () => {
  // The words shipped by @tensorflow-models/speech-commands "18w" browser_fft model.
  const vocabulary = [
    '_background_noise_', '_unknown_', 'down', 'eight', 'five', 'four', 'go', 'left', 'nine',
    'no', 'one', 'right', 'seven', 'six', 'stop', 'three', 'two', 'up', 'yes', 'zero',
  ];
  for (const word of Object.keys(VOICE_WORDS)) {
    assert(vocabulary.includes(word), `"${word}" is not a word the model can recognise`);
  }
});

check('noise and digits are never mapped to an action', () => {
  for (const word of ['_background_noise_', '_unknown_', 'yes', 'no', 'stop', 'three', 'zero']) {
    assert(!VOICE_WORDS[word], `"${word}" should not drive the claw`);
  }
});

check('the mic slider moves the confidence threshold the usable way round', () => {
  const strict = voiceThreshold(0.5);
  const mid = voiceThreshold(1);
  const forgiving = voiceThreshold(2);
  assert(strict > mid && mid > forgiving, `raising sensitivity should lower the bar (${strict}, ${mid}, ${forgiving})`);
  assert(strict <= 0.92 && forgiving >= 0.4, 'the threshold should stay inside sane limits');
  assert(mid > 0.5 && mid < 0.85, `the default should be a usable middle, got ${mid}`);
});

check('the threshold is clamped for out-of-range sensitivity', () => {
  assert(voiceThreshold(-5) <= 0.92, 'a tiny sensitivity should not exceed the cap');
  assert(voiceThreshold(99) >= 0.4, 'a huge sensitivity should not fall below the floor');
});

check('a voice game that owns its mic does not also ask for the shared meter', () => {
  const claw = GAMES.find((g) => g.slug === 'claw-machine')!;
  assert(claw.ownsMicInput === true, 'claw-machine should own its mic input');
  assert(claw.showMicMeter === false, 'a game owning the mic must not show the shared meter');
  assert(claw.calibrateMic === false, 'a command model needs no loudness calibration');
});

check('games that use the shared mic meter are left alone', () => {
  const chicken = GAMES.find((g) => g.slug === 'scream-chicken')!;
  assert(!chicken.ownsMicInput, 'scream-chicken should keep using the shared mic meter');
});

console.log('\nClaw Machine · round, timer and restart');

check('the round ends when the credits run out', () => {
  const s = createClawState(fixedPit());
  // Park the claw away from every prize so each attempt is a clean miss.
  s.x = BOUNDS.maxX;
  s.z = BOUNDS.minZ;
  let over = null;
  for (let i = 0; i < START_CREDITS; i++) {
    const events = fullGrab(s);
    over = events.find((e) => e.type === 'over') ?? over;
    if (s.ended) break;
    run(s, 0.1);
  }
  assert(s.credits === 0, `all credits should be spent, ${s.credits} left`);
  assert(s.ended, 'the round should be over');
  assert(over?.note?.includes('Out of credits'), `unexpected note: ${over?.note}`);
});

check('the round ends when the timer runs out', () => {
  const s = createClawState(fixedPit());
  const events = run(s, ROUND_SECONDS + 1);
  const over = events.find((e) => e.type === 'over');
  assert(s.timeLeft === 0, 'the clock should hit zero');
  assert(over?.note?.includes('Time is up'), `unexpected note: ${over?.note}`);
  assert(s.ended, 'the round should be over');
});

check('the timer does not cut a paid grab short', () => {
  const s = createClawState(fixedPit());
  s.timeLeft = 0.2;
  s.x = s.prizes[2].x;
  s.z = s.prizes[2].z;
  startGrab(s);
  const events = finishGrab(s);
  assert(events.some((e) => e.type === 'scored'), 'a paid grab should finish even as the clock expires');
  assert(s.ended, 'the round should end once the grab completes');
});

check('a finished round ignores further input', () => {
  const s = createClawState(fixedPit());
  run(s, ROUND_SECONDS + 1);
  const x = s.x, credits = s.credits;
  run(s, 1, { right: true });
  assert(startGrab(s) === null, 'grab should be refused after the round ends');
  near(s.x, x, 1e-9, 'the claw must not move after the round ends');
  assert(s.credits === credits, 'credits must not change after the round ends');
});

check('clearing the cabinet ends the round', () => {
  const s = createClawState(fixedPit());
  s.credits = 99;
  for (const p of s.prizes) p.collected = true;
  s.prizes[0].collected = false;
  const target = s.prizes[0];
  s.x = target.x;
  s.z = target.z;
  const events = fullGrab(s);
  const over = events.find((e) => e.type === 'over');
  assert(over?.note?.includes('Cabinet cleared'), `unexpected note: ${over?.note}`);
});

check('restart gives a fresh machine', () => {
  const s = createClawState(fixedPit());
  s.x = s.prizes[2].x;
  s.z = s.prizes[2].z;
  fullGrab(s);
  assert(s.score > 0 && s.credits < START_CREDITS, 'first round should have progressed');
  const fresh = createClawState(fixedPit());
  assert(fresh.score === 0, 'a new round starts at zero score');
  assert(fresh.credits === START_CREDITS, 'a new round restores the credits');
  assert(fresh.timeLeft === ROUND_SECONDS, 'a new round restores the clock');
  assert(fresh.won === 0 && fresh.held === null && !fresh.ended, 'a new round is clean');
  assert(fresh.prizes.every((p: Prize) => !p.collected && !p.held), 'a new round refills the pit');
  assert(fresh.x === 0 && fresh.z === 0, 'the claw starts centred');
});

check('difficulty stays configurable through reachScale', () => {
  const easy = createClawState(fixedPit());
  const hard = createClawState(fixedPit());
  const target = easy.prizes[2];
  const offset = GRAB_RADIUS * HOLD_FRACTION + 0.1;
  easy.reachScale = 1.6;
  hard.reachScale = 0.6;
  easy.x = target.x + offset;
  easy.z = target.z;
  hard.x = target.x + offset;
  hard.z = target.z;
  assert(resolveGrab(easy) !== null, 'a wide reach should forgive the same offset');
  assert(resolveGrab(hard) === null, 'a narrow reach should reject it');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
