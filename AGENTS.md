# AGENTS.md

A guide for AI coding agents (and people) working on this repo: what is where, how it fits
together, and the rules for editing it.

## What this is

OpenArcade is a browser arcade played with hand gestures (MediaPipe), voice loudness (Web Audio)
or a RAG quiz. It is a Vite + TypeScript app with **no UI framework**: plain DOM, Canvas 2D,
Three.js for 3D, and plain CSS with custom properties.

## Commands

```bash
npm install
npm run dev         # dev server, http://localhost:5173
npm run build       # tsc --noEmit + vite build -> dist/  (run this before you commit)
npm run preview     # serve dist/
npm run export-kb   # regenerate knowledge/<slug>.md from app/src/games.ts
```

There is no test runner. Check your work with `npm run build`, then play the game in the
browser with the keyboard. Use `?debug=1` on a game URL to see the raw hand and mic values.

## Layout

```
app/                         Vite root (vite.config.ts sets root: 'app')
  index.html                 Landing page markup + ALL design tokens and landing CSS (inline <style>)
  src/
    main.ts                  Entry. Picks the route, lazy-loads that page, mounts Pip
    router.ts                "/" | "/play/:slug" | missing. Navigation is a full page load
    games.ts                 SINGLE SOURCE OF TRUTH for the seven games (see below)
    landing/landing.js       Cabinet, attract demos (256x192 pixel canvas), terrain (Three.js)
    play/
      page.ts                Game page shell: Ready screen, permissions, countdown, HUD, pause, game over
      types.ts               GameContext / GameInstance / GameModule: the contract every game implements
      play.css               Game page styles
      notFound.ts, screen.css  CRT "Game not found" screen
    input/
      hand.ts                MediaPipe HandLandmarker -> { present, x, y, gesture, confidence, jumpEvent, tilt }
      mic.ts                 Loudness -> { level, smoothed, noiseFloor } + calibrate() + loudness(sensitivity)
      keys.ts                Keyboard state: down(code), pressed(code)
      media.ts               getUserMedia wrappers with plain-words errors
    games/
      registry.ts            slug -> lazy import() of the game module (one chunk per game)
      shared/                canvas.ts (640x360 pixel surface), pixel.ts (palette + bitmaps)
      apex-drive/  rail-rush/  hill-climb/  rps/  scream-chicken/  claw-machine/  quiz-battle/
      apex-drive/physics.ts and claw-machine/logic.ts hold those games' rules with no
      THREE or DOM imports, so npm test can drive them head-less
    pip/                     Guide bot: pip.ts (UI + chat), face.ts (16x16 face), bus.ts (openPip event)
    api/                     config.ts (env), chat.ts (SSE/JSON client), quiz.ts
    mocks/                   chat.ts and quiz.ts, used when VITE_USE_MOCK is not "false"
    lib/                     storage.ts (guarded local/session storage), sound.ts (beeps)
scripts/export-kb.ts         Writes knowledge/*.md from games.ts
scripts/test-games.ts        npm test: cabinet wiring + Apex Drive and Claw Machine rules
knowledge/                   Generated. Do not hand-edit; edit games.ts and re-run export-kb
```

### Files that belong to teammates: do not edit

- `index.html`, `style.css`, `game.js`, `game-backup.js` at the repo root: the original ScreamLeap prototype.
- `subway_runner/`: the original Python Subway Runner with its YOLO model.

The web versions in `app/src/games/scream-chicken` and `app/src/games/rail-rush` are ports of
these. Their header comments credit the originals. Change the ports, never the originals. If
you must touch a teammate's folder, keep it to a thin adapter and list the file in your summary.

## How a game page runs

1. `main.ts` sees `/play/<slug>`, finds the game in `games.ts` and mounts `play/page.ts`.
2. The Ready screen shows the title, `rules[]` and `needs`. **Start** does three things in order:
   fullscreen (it needs the click, so it must come first), then `getUserMedia`, then MediaPipe
   or the mic calibration. "Play with keyboard instead" skips the devices.
3. The shell imports the game through `games/registry.ts`, calls `create(ctx)`, runs a 3-2-1
   countdown (unless the module exports `countdown = false`), then calls `instance.update(dt)`
   every frame while playing.
4. The game calls `ctx.setScore()`, `ctx.setInfo()` and finally `ctx.gameOver(score, note)`. The
   shell shows Game over, saves the best score (`localStorage oa:best:<slug>`) and offers Retry.
5. On Exit or page hide, the shell stops the camera and mic tracks and leaves fullscreen.

`ctx.hand` and `ctx.mic` are `null` in keyboard mode. **Every game must be playable with the
keyboard alone** (arrows, space, 1-4).

## Adding or changing a game

1. Add the game object to `GAMES` in `app/src/games.ts` with every field filled in. Keep the
   list order: hand games, then voice, then RAG. `color` comes from `INPUT_META[input].color`.
2. Create `app/src/games/<folder>/index.ts`:
   ```ts
   import type { GameContext, GameInstance } from '../../play/types';
   export const countdown = true;
   export function create(ctx: GameContext): GameInstance {
     // put a canvas or DOM into ctx.view (16:9, letterboxed)
     return { update(dt) { /* step + draw */ }, destroy() { /* remove DOM, dispose GPU objects */ } };
   }
   ```
   For a pixel game, use `createSurface(ctx.view)` from `games/shared/canvas.ts` and the palette in `shared/pixel.ts`.
3. Register it in `app/src/games/registry.ts`. The key is the slug; the folder name can differ.
4. Add an attract demo for the cabinet in `landing/landing.js` (`DEMOS` map, 256x192, same pixel style).
5. If the input type is new or changed, update the "Three ways to control a game" section in `app/index.html`.
6. Run `npm run export-kb` and commit the regenerated `knowledge/` files.
7. Run `npm run build`, then play the game with the keyboard and with `?debug=1`.

Reading input inside `update(dt)`:
- Hand jumps: compare `ctx.hand.jumpEvent` with the last value you saw. It is a counter, not a flag.
- Gestures: `'open' | 'fist' | 'peace' | 'point' | 'none'`. Check `confidence` (0..1) before acting on one.
- Mic: `ctx.mic.loudness(ctx.settings.sensitivity)` gives 0..1 above the calibrated noise floor.
- Keys: `ctx.keys.pressed('Space')` fires once per press, `ctx.keys.down('ArrowRight')` while held.

## Design rules (keep them)

- **The landing page look is fixed.** Don't redesign `app/index.html` or its CSS. It came from the original OpenArcade design.
- Tokens are on `:root` in `app/index.html`: `--bg --bg2 --line --line2 --fg --soft --mute --cyan --pink --coin --violet --horizon`, plus the font variables `--f-display` (Jersey 10), `--f-body` (Chakra Petch) and `--f-crt` (VT323). Use the variables; don't hard-code new colours.
- **Colour means input type**: cyan = hand, pink = voice, yellow = RAG/notes. This applies to list tags, accents and Pip's source chips.
- One dark theme. Square corners, thick black borders with an inset `--line2` ring, scanlines, a CRT power-on animation.
- No emoji, no images: all art is drawn in code. No Inter or Space Grotesk, no gradient SaaS cards, no scroll-reveal fades.
- Respect `prefers-reduced-motion` in every animation, in CSS and in JS (`ctx.reducedMotion`).
- Copy is for players: sentence case, plain verbs. Errors say what happened and how to fix it.
- Responsive from 360px, keyboard accessible, visible focus states, no horizontal scroll.

## Code conventions

- TypeScript, strict. `landing/landing.js` is the one plain-JS file. It is the original page script and keeps its compact ES5 style, so match that style when editing it.
- Each route, game, Pip, pdf.js and MediaPipe is loaded with dynamic `import()`. Keep it that way so the landing page stays light.
- Wrap browser storage in `lib/storage.ts` (or try/catch). It can throw in private windows.
- Dependencies are pinned to exact versions. Ask before adding one. `MP_VERSION` in `input/hand.ts` must match `@mediapipe/tasks-vision` in package.json.
- Pip's backend contract is documented in README.md. If you change `api/chat.ts` or `api/quiz.ts`, change the matching mock and the README too.

## Git

Work on a feature branch, make small commits, and don't push or rewrite history unless asked.
`BRIEF.md` and `OpenArcade.html` (the original design reference) stay untracked.
