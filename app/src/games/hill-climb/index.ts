// Hill Climb: a side-view car on endless procedural hills across three zones.
// Open palm = gas, fist = brake, index finger = jump; in the air the gas spins a
// backflip and the fist a frontflip. Ported from the team's standalone gesture
// page: the shell owns the camera and MediaPipe, this module classifies the raw
// landmarks with the original rotation-proof finger test and runs the game.
import type { GameContext, GameInstance } from '../../play/types';
import { createSurface } from '../shared/canvas';

export const countdown = true;

// ================= THEME (all canvas colors live here) =================
interface Zone { name: string; [k: string]: string }
const PAL: Zone[] = [
  { name: 'NEON CITY', skyTop: '#07040f', skyBot: '#2b1458', ridge: '#12062a', star: '#cfc4f2', ground: '#0d0620', edge: '#19f0ff', car: '#ff8a3d', carTop: '#ffb681',
    rock: '#47228f', rockDark: '#2f1766', crate: '#c98a4b', crateDark: '#7a4f22', coin: '#ffe14a' },
  { name: 'CANYON', skyTop: '#140607', skyBot: '#a53a12', ridge: '#5c2412', star: '#ffd9a8', ground: '#2c1210', edge: '#ffb04a', car: '#19f0ff', carTop: '#8ff7ff',
    rock: '#a0603a', rockDark: '#6b3a22', crate: '#d9a05b', crateDark: '#7a4a1e', coin: '#ffe066' },
  { name: 'MOON', skyTop: '#03040c', skyBot: '#141a4a', ridge: '#1d2150', star: '#ffffff', ground: '#23273f', edge: '#cfc4f2', car: '#ff8a3d', carTop: '#ffb681',
    rock: '#8f95b8', rockDark: '#585d80', crate: '#7a82b0', crateDark: '#454b73', coin: '#ffe14a' },
];
// fixed colors + the live (blended) palette. All canvas drawing reads THEME.
const THEME: Zone = Object.assign({ glass: '#07040f', wheel: '#efe9ff', fuel: '#ff2bd6', text: '#efe9ff', dim: '#a99bd8', good: '#19f0ff', bad: '#ff2bd6', overlay: 'rgba(7,4,15,.78)' }, PAL[0]);
const ZONE_M = [1500, 3000];            // metres where the path changes
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const zoneF = (x: number) => { const m = (x - 100) / 10; return smooth(ZONE_M[0] - 100, ZONE_M[0] + 100, m) + smooth(ZONE_M[1] - 100, ZONE_M[1] + 100, m); };
function updateTheme(carX: number) {
  const zf = zoneF(carX), i = Math.min(1, Math.floor(zf)), t = zf - i;
  for (const k in PAL[0]) if (k !== 'name') THEME[k] = mix(PAL[i][k], PAL[i + 1][k], t);
}
const FINGER_RATIO = 1.08;   // raise to ~1.15 if gestures flicker

// ================= Types =================
type P = { x: number; y: number };
type GestureName = 'idle' | 'gas' | 'brake' | 'jump';
interface Car { x: number; y: number; v: number; vx: number; vy: number; angle: number; spin: number; rot: number; air: boolean; prevS: number; fuel: number; hp: number; inv: number; jumpCd: number; wheel: number }
interface Obs { t: string; w: number; h: number; x: number; hit: boolean }
interface Item { t: 'coin' | 'fuel'; x: number; y: number; got: boolean }
interface Part { x: number; y: number; vx: number; vy: number; life: number; col: string }
interface Pop { text: string; col: string; life: number }

const dist2 = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function classify(h: P[]): 'gas' | 'brake' | 'jump' | null {      // rotation-proof: finger is up when its tip is farther from the wrist than its middle joint
  const e = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([t, p]) => dist2(h[t], h[0]) > dist2(h[p], h[0]) * FINGER_RATIO);
  const n = e.filter(Boolean).length;
  if (e[0] && n === 1) return 'jump';     // only the index finger
  if (n >= 3) return 'gas';
  if (n === 0) return 'brake';
  return null;                            // 2 fingers: ambiguous, keep previous
}

export function create(ctx: GameContext): GameInstance {
  const s = createSurface(ctx.view, 800, 450);
  const g = s.g;
  const W = s.canvas.width, H = s.canvas.height, R = 9, STEP = 1000 / 60;
  const ctl = { gesture: 'idle' as GestureName, jumpAt: -1e9 };
  let car: Car, obs: Obs[], items: Item[], parts: Part[], pops: Pop[];
  let camY = 0, zone = 0, nextX = 0, coins = 0, shake = 0, over = false, jumped = false, spawned = 0;
  let t = 0, acc = 0;

  function ground(x: number): number {
    const k = Math.min(x / 8000, 1), zf = zoneF(x);
    const t0 = 330 + Math.sin(x * 0.004) * (30 + 50 * k) + Math.sin(x * 0.011 + 1.3) * (10 + 22 * k) + Math.sin(x * 0.0007) * 40;   // neon city
    const t1 = 330 + Math.sin(x * 0.0030) * 95 + Math.sin(x * 0.0085 + 0.6) * 28 + Math.sin(x * 0.0007) * 40;                      // canyon: big rolling dunes
    const t2 = 330 + Math.sin(x * 0.0022) * 120 + Math.sin(x * 0.006 + 2) * 18 + Math.sin(x * 0.0007) * 40;                        // moon: long slow hills
    return zf <= 1 ? t0 + (t1 - t0) * zf : t1 + (t2 - t1) * (zf - 1);
  }
  const slopeAt = (x: number) => Math.atan2(ground(x + 12) - ground(x - 12), 24);
  const rnd = () => Math.random();

  function reset() {
    car = { x: 100, y: ground(100) - R, v: 0, vx: 0, vy: 0, angle: 0, spin: 0, rot: 0, air: false, prevS: 0, fuel: 100, hp: 100, inv: 0, jumpCd: 0, wheel: 0 };
    obs = []; items = []; parts = []; pops = []; nextX = 1400; zone = 0; camY = car.y - 280; coins = 0; shake = 0; jumped = false; spawned = 0;
    ctl.jumpAt = -1e9;
  }
  reset();

  // ================= Level generation (endless, gets denser) =================
  function spawn() {
    while (nextX < car.x + W + 1400) {
      const k = Math.min(nextX / 12000, 1), r = rnd();
      let o: Obs;
      if (r < 0.6) o = { t: 'rock', w: 34, h: 22 + rnd() * 8, x: 0, hit: false };
      else if (r < 0.85) o = { t: 'crate', w: 38, h: 44, x: 0, hit: false };
      else o = { t: 'log', w: 74, h: 18, x: 0, hit: false };
      o.x = nextX;
      obs.push(o);
      for (let j = -1; j <= 1; j++) {                       // coin arc rewards the jump
        const cx = nextX + j * 38;
        items.push({ t: 'coin', x: cx, y: ground(cx) - o.h - 40 - (j === 0 ? 14 : 0), got: false });
      }
      const gap = 1000 - 250 * k + rnd() * 550;              // roughly 1 obstacle every 2 to 3 seconds
      if (rnd() < 0.6) for (let j = 0; j < 5; j++) { const cx = nextX + gap * 0.5 + j * 45; items.push({ t: 'coin', x: cx, y: ground(cx) - 34, got: false }); }
      if (++spawned % 4 === 0) { const fx = nextX + gap * 0.3; items.push({ t: 'fuel', x: fx, y: ground(fx) - 26, got: false }); }
      nextX += gap;
    }
    if (obs.length > 40) { obs = obs.filter(o => o.x > car.x - 500); items = items.filter(i => i.x > car.x - 500 && !i.got); }
  }

  // ================= Input =================
  function pressJump() {
    ctl.jumpAt = performance.now();
  }
  s.canvas.addEventListener('pointerdown', pressJump);

  let held: GestureName = 'idle', cand: 'gas' | 'brake' | 'jump' | null = null, candN = 0;
  let lastLm: P[] | null = null, lastSeen = 0;
  function readHand() {
    const hand = ctx.hand;
    const now = performance.now();
    if (hand && hand.present && hand.landmarks.length) {
      lastSeen = now;
      // hand.ts only replaces the landmarks array when a new camera frame arrives,
      // so classifying on change keeps the original 2-frame debounce cadence.
      if (hand.landmarks === lastLm) return;
      lastLm = hand.landmarks;
      const g = classify(hand.landmarks);
      if (g) {
        if (g === cand) candN++; else { cand = g; candN = 1; }
        if (candN >= 2 && g !== held) { held = g; if (g === 'jump') pressJump(); }   // 2 frames in a row = debounce
      }
      ctl.gesture = held === 'jump' ? 'idle' : held;
    } else if (now - lastSeen > 500) {      // brief dropouts keep the last gesture; only a real loss coasts
      ctl.gesture = 'idle'; held = 'idle'; cand = null;
    }
  }
  function controls() {
    let gas = ctx.keys.down('ArrowRight') || ctx.keys.down('KeyD');
    let brake = ctx.keys.down('ArrowLeft') || ctx.keys.down('KeyA');
    if (ctx.keys.pressed('Space') || ctx.keys.pressed('ArrowUp') || ctx.keys.pressed('KeyW') || ctx.keys.pressed('Enter')) pressJump();
    gas = gas || ctl.gesture === 'gas';
    brake = (brake || ctl.gesture === 'brake') && !gas;
    if (car.fuel <= 0) gas = false;
    return { gas, brake };
  }

  // ================= Physics (fixed 60 Hz step, same feel on any monitor) =================
  function burst(x: number, y: number, col: string, n: number) { for (let i = 0; i < n; i++) parts.push({ x, y, vx: (rnd() - .5) * 5, vy: -rnd() * 4, life: 30 + rnd() * 20, col }); }
  function pop(text: string, col: string) { pops.push({ text, col, life: 90 }); }
  function crash(why: string) {
    if (over) return;
    over = true;
    ctx.gameOver(score(), why);
  }

  function step() {
    const c = car;
    const { gas, brake } = controls();
    if (c.jumpCd > 0) c.jumpCd--;
    if (c.inv > 0) c.inv--;
    spawn();
    const zi = dist_m() >= ZONE_M[1] ? 2 : dist_m() >= ZONE_M[0] ? 1 : 0;
    if (zi > zone) { zone = zi; pop('ZONE ' + (zi + 1) + ': ' + PAL[zi].name, THEME.edge); shake = 8; }

    if (!c.air) {
      const sl = slopeAt(c.x);
      if (performance.now() - ctl.jumpAt < 300 && c.jumpCd <= 0) {     // buffered jump
        c.air = true; c.vx = c.v * Math.cos(sl); c.vy = c.v * Math.sin(sl) - 9; c.spin = 0; c.rot = 0; c.jumpCd = 14; ctl.jumpAt = -1e9; jumped = true;
        burst(c.x, c.y + R, THEME.edge, 8);
      } else {
        if (gas && c.fuel > 0) c.v += 0.14;
        if (brake) c.v += c.v > 0 ? -0.28 : -0.08;
        c.v += Math.sin(sl) * 0.16; c.v *= 0.992;
        c.v = Math.max(-3, Math.min(c.v, 13));
        if (!gas && !brake && Math.abs(c.v) < 0.05) c.v = 0;
        if (c.v > 5 && sl - c.prevS > 0.014) { c.air = true; c.vx = c.v * Math.cos(c.prevS); c.vy = c.v * Math.sin(c.prevS); c.spin = 0; c.rot = 0; }
        else { c.x += c.v * Math.cos(sl); c.y = ground(c.x) - R; c.angle += (sl - c.angle) * 0.25; }
      }
      c.prevS = sl;
    }
    if (c.air) {
      const G = 0.3 - 0.14 * Math.max(0, zoneF(c.x) - 1);           // moon zone = low gravity = long flips
      c.vy += G; c.x += c.vx; c.y += c.vy;
      const target = gas ? -0.13 : brake ? 0.13 : 0;                // rate control: hold gas = backflip, hold fist = frontflip
      c.spin += (target - c.spin) * (target ? 0.14 : 0.2);
      c.angle += c.spin; c.rot += c.spin;
      const gy = ground(c.x) - R;
      if (gy - c.y < 80 && c.vy > 0) {                              // landing assist: gently levels you out near the ground (weaker while you hold a gesture)
        const s0 = slopeAt(c.x), e = c.angle - s0, k = Math.round(e / (Math.PI * 2)), err = e - k * Math.PI * 2;
        if (Math.abs(err) < 1.3) { const dA = -err * (gas || brake ? 0.05 : 0.1); c.angle += dA; c.rot += dA; }
      }
      if (c.y >= gy) {
        const sl = slopeAt(c.x);
        let d = c.angle - sl; d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > 1.5) return crash('FLIPPED');                 // landed on the roof
        const flips = Math.round(Math.abs(c.rot) / (Math.PI * 2));
        c.angle = sl + d;                                               // normalise so a landed 360 doesn't unwind
        c.air = false; c.y = gy; c.v = Math.max(c.vx * Math.cos(sl) + c.vy * Math.sin(sl), 0) * 0.88; c.prevS = sl;
        if (Math.abs(d) > 0.95) {                                        // rough landing: damage, not instant death
          c.hp -= 34; c.inv = 60; shake = 10; c.v *= 0.5; pop('ROUGH LANDING', THEME.bad);
          if (c.hp <= 0) return crash('WRECKED');
        } else if (flips > 0) {
          coins += flips * 5; pop((flips > 1 ? flips + 'x ' : '') + (c.rot < 0 ? 'BACKFLIP' : 'FRONTFLIP') + '!  +' + flips * 5, THEME.coin);
        }
        burst(c.x, c.y + R, THEME.dim, 6);
      }
    }
    c.wheel += c.v * 0.12;
    c.fuel -= gas ? 0.06 : 0.02;
    if (c.fuel <= 0 && Math.abs(c.v) < 0.2 && !c.air) return crash('OUT OF FUEL');

    for (const o of obs) {                                           // obstacle collisions
      if (o.hit || Math.abs(c.x - o.x) > o.w / 2 + 22) continue;
      if (ground(c.x) - (c.y + R) < o.h - 4) {
        o.hit = true; burst(o.x, ground(o.x) - o.h / 2, o.t === 'crate' ? THEME.crate : THEME.rock, 14);
        if (c.inv <= 0) {
          c.hp -= 34; c.inv = 60; shake = 10;
          if (c.air) c.vx *= 0.3; else c.v = -1.5;
          if (c.hp <= 0) return crash('WRECKED');
        }
      }
    }
    for (const it of items) {                                        // pickups
      if (it.got || Math.abs(it.x - c.x) > 40) continue;
      if (Math.hypot(c.x - it.x, c.y - 14 - it.y) < (it.t === 'fuel' ? 34 : 30)) {
        it.got = true;
        if (it.t === 'fuel') c.fuel = Math.min(100, c.fuel + 45); else coins++;
      }
    }
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life--; }
    parts = parts.filter(p => p.life > 0);
    for (const p of pops) p.life--;
    pops = pops.filter(p => p.life > 0);
    if (shake > 0) shake--;
  }
  const dist_m = () => Math.max(0, Math.floor((car.x - 100) / 10));
  const score = () => dist_m() + coins * 10;

  // ================= Rendering =================
  const stars = Array.from({ length: 60 }, () => [rnd() * W, rnd() * 220, rnd() * 1.5 + .3] as const);
  function drawObstacle(o: Obs, camX: number) {
    g.save(); g.translate(o.x - camX, ground(o.x)); g.rotate(slopeAt(o.x));
    const w = o.w, h = o.h;
    if (o.t === 'rock') {
      g.fillStyle = THEME.rock; g.beginPath(); g.moveTo(-w / 2, 2); g.lineTo(-w / 3, -h); g.lineTo(w / 5, -h * .9); g.lineTo(w / 2, 2); g.fill();
      g.fillStyle = THEME.rockDark; g.beginPath(); g.moveTo(w / 5, -h * .9); g.lineTo(w / 2, 2); g.lineTo(0, 2); g.fill();
    } else if (o.t === 'crate') {
      g.fillStyle = THEME.crate; g.fillRect(-w / 2, -h, w, h);
      g.strokeStyle = THEME.crateDark; g.lineWidth = 3; g.strokeRect(-w / 2, -h, w, h);
      g.beginPath(); g.moveTo(-w / 2, -h); g.lineTo(w / 2, 0); g.moveTo(w / 2, -h); g.lineTo(-w / 2, 0); g.stroke();
    } else {
      g.fillStyle = THEME.crateDark; g.fillRect(-w / 2, -h, w, h);
      g.fillStyle = THEME.crate; g.beginPath(); g.ellipse(-w / 2, -h / 2, 5, h / 2, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(w / 2, -h / 2, 5, h / 2, 0, 0, 7); g.fill();
    }
    g.restore();
  }
  function draw() {
    updateTheme(car.x); camY += (car.y - 280 - camY) * 0.1; const cy = camY;
    const camX = car.x - 220, sx = shake ? (rnd() - .5) * shake : 0, sy = shake ? (rnd() - .5) * shake : 0;
    g.save(); g.translate(sx, sy);
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, THEME.skyTop); grd.addColorStop(1, THEME.skyBot);
    g.fillStyle = grd; g.fillRect(-10, -10, W + 20, H + 20);
    g.fillStyle = THEME.star; for (const [x, y, r] of stars) g.fillRect(((x - camX * 0.05) % W + W) % W, y, r, r);
    g.fillStyle = THEME.ridge; g.beginPath(); g.moveTo(0, H);
    for (let i = 0; i <= W; i += 10) g.lineTo(i, 250 - cy * 0.25 + Math.sin((i + camX * 0.25) * 0.006) * 40 + Math.sin((i + camX * 0.25) * 0.017) * 14);
    g.lineTo(W, H); g.fill();
    g.save(); g.translate(0, -cy); const BOT = cy + H + 80;
    g.beginPath(); g.moveTo(0, BOT); for (let i = 0; i <= W; i += 6) g.lineTo(i, ground(camX + i)); g.lineTo(W, BOT); g.closePath();
    g.fillStyle = THEME.ground; g.fill();
    g.lineWidth = 3; g.strokeStyle = THEME.edge; g.shadowColor = THEME.edge; g.shadowBlur = 10; g.beginPath();
    for (let i = 0; i <= W; i += 6) { const y = ground(camX + i); i ? g.lineTo(i, y) : g.moveTo(i, y); }
    g.stroke(); g.shadowBlur = 0;

    for (const o of obs) if (!o.hit && o.x - camX > -80 && o.x - camX < W + 80) drawObstacle(o, camX);
    for (const it of items) {
      const px = it.x - camX; if (it.got || px < -20 || px > W + 20) continue;
      if (it.t === 'fuel') { g.fillStyle = THEME.fuel; g.fillRect(px - 9, it.y - 12, 18, 22); g.fillStyle = THEME.wheel; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.fillText('F', px, it.y + 4); }
      else { g.fillStyle = THEME.coin; g.beginPath(); g.arc(px, it.y, 7, 0, 7); g.fill(); }
    }
    for (const p of parts) { g.globalAlpha = Math.min(1, p.life / 20); g.fillStyle = p.col; g.fillRect(p.x - camX, p.y, 4, 4); } g.globalAlpha = 1;

    g.save(); g.translate(car.x - camX, car.y); g.rotate(car.angle);
    if (car.inv > 0 && Math.floor(car.inv / 5) % 2) g.globalAlpha = .35;
    g.fillStyle = THEME.car; g.fillRect(-26, -20, 52, 12);
    g.fillStyle = THEME.carTop; g.fillRect(-12, -30, 24, 11);
    g.fillStyle = THEME.glass; g.fillRect(-9, -28, 18, 7);
    for (const wx of [-17, 17]) {
      g.save(); g.translate(wx, 0); g.rotate(car.wheel);
      g.fillStyle = THEME.wheel; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
      g.strokeStyle = THEME.glass; g.lineWidth = 2; g.beginPath(); g.moveTo(-R, 0); g.lineTo(R, 0); g.stroke(); g.restore();
    }
    g.restore(); g.restore(); g.restore();

    // HUD
    g.textAlign = 'center'; g.fillStyle = THEME.text; g.font = 'bold 16px monospace'; g.fillText(`${dist_m()} m`, W / 2, 30);
    g.fillStyle = THEME.dim; g.font = '12px monospace'; g.fillText(`coins ${coins}`, W / 2, 48);
    for (let i = 0; i < 3; i++) { g.fillStyle = i < Math.ceil(car.hp / 34) ? THEME.bad : THEME.ground; g.fillRect(W / 2 - 25 + i * 18, 58, 14, 10); }
    g.strokeStyle = THEME.dim; g.lineWidth = 1; g.strokeRect(W - 160, 74, 140, 12);
    g.fillStyle = car.fuel > 25 ? THEME.good : THEME.bad; g.fillRect(W - 159, 75, Math.max(0, car.fuel) * 1.38, 10);
    g.fillStyle = THEME.dim; g.textAlign = 'right'; g.fillText('fuel', W - 20, 102);
    g.textAlign = 'center'; g.font = 'bold 24px monospace';
    for (const p of pops) { g.globalAlpha = Math.min(1, p.life / 30); g.fillStyle = p.col; g.fillText(p.text, W / 2, 130 - (90 - p.life) * 0.4); } g.globalAlpha = 1;
    const nxt = obs.find(o => !o.hit && o.x > car.x);
    if (!jumped && nxt && nxt.x - car.x < 480) { g.fillStyle = THEME.coin; g.textAlign = 'center'; g.font = 'bold 18px monospace'; g.fillText('POINT YOUR INDEX FINGER TO JUMP', W / 2, 90); }
    if (!ctx.hand && t < 6) { g.fillStyle = THEME.dim; g.font = '16px monospace'; g.fillText('RIGHT/D GAS · LEFT/A BRAKE · SPACE JUMP', W / 2, H - 24); }
    if (ctx.hand && !ctx.hand.present) { g.fillStyle = THEME.bad; g.font = '16px monospace'; g.fillText('SHOW YOUR HAND TO THE CAMERA', W / 2, H - 24); }
  }

  return {
    update(dt) {
      if (over) return;
      t += dt;
      readHand();
      acc += Math.min(dt, 0.1) * 1000;
      while (acc >= STEP) { step(); acc -= STEP; }
      ctx.setScore(score());
      ctx.setInfo(`${coins} COINS`);
      draw();
    },
    destroy() {
      s.canvas.removeEventListener('pointerdown', pressJump);
      s.canvas.remove();
    },
  };
}
