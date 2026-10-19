// Full-screen game page (/play/:slug): Ready screen, permissions, countdown, HUD, pause,
// game over, and the camera / mic plumbing every game shares.
import { GAME_LOADERS } from '../games/registry';
import type { Game } from '../games';
import { startHandTracker, type HandTracker } from '../input/hand';
import { createKeys } from '../input/keys';
import { requestCamera, requestMic, stopStream } from '../input/media';
import { startMic, type MicMeter } from '../input/mic';
import { createSound } from '../lib/sound';
import { getBest, saveBest } from '../lib/storage';
import { openPip, isPipOpen } from '../pip/bus';
import { go } from '../router';
import type { GameContext, GameInstance, GameModule } from './types';
import './screen.css';
import './play.css';

type Phase = 'ready' | 'starting' | 'error' | 'countdown' | 'playing' | 'paused' | 'over';

const NEEDS_TEXT = {
  camera: 'Needs your camera. Video stays on this device.',
  mic: 'Needs your microphone. Audio stays on this device.',
  none: 'Needs nothing but a keyboard or mouse.',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function readMuted(): boolean {
  try {
    return localStorage.getItem('oa:muted') === '1';
  } catch {
    return false;
  }
}

export function mount(root: HTMLElement, game: Game): void {
  document.title = `${game.title} · OpenArcade`;
  document.documentElement.classList.add('is-play');
  const params = new URLSearchParams(location.search);
  const debug = params.get('debug') === '1';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const keyboardHint = game.controls.find((c) => c.startsWith('Keyboard')) ?? '';

  root.innerHTML = `
  <div class="pl" style="--c:${game.color}">
    <div class="pl-view" id="plView"></div>
    <div class="pl-hud" id="plHud" hidden>
      <div class="pl-score"><span>SCORE</span><b id="plScore">0</b><em id="plInfo"></em></div>
      <div class="pl-tools">
        <button type="button" class="pl-tool" data-act="pause" aria-label="Pause">II</button>
        <button type="button" class="pl-tool" data-act="mute" aria-pressed="false" aria-label="Mute sound">SND</button>
        <button type="button" class="pl-tool" data-act="fullscreen" aria-label="Toggle fullscreen">[ ]</button>
        <button type="button" class="pl-tool" data-act="rules" aria-label="Rules: ask Pip">?</button>
        <button type="button" class="pl-tool" data-act="exit" aria-label="Exit to the arcade">EXIT</button>
      </div>
    </div>
    <div class="pl-cam" id="plCam" hidden>
      <video id="plVideo" playsinline muted></video>
      <canvas id="plCamCv" width="160" height="120" aria-hidden="true"></canvas>
      <span class="pl-light" id="plLight">NO HAND</span>
    </div>
    <div class="pl-meter" id="plMeter" hidden aria-hidden="true">
      <div class="pl-meter-bar"><i id="plMeterFill"></i></div><span>MIC</span>
    </div>
    <pre class="pl-debug" id="plDebug" hidden></pre>
    <div class="pl-overlay" id="plOverlay" role="dialog" aria-modal="true" aria-labelledby="plTitle"></div>
    <div class="pl-rotate" role="alert">
      <div class="pl-panel"><h2 class="pl-h">Rotate your phone</h2><p>This game plays sideways. Turn your phone to landscape to continue.</p></div>
    </div>
  </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const view = $('plView'), hud = $('plHud'), overlay = $('plOverlay');
  const scoreEl = $('plScore'), infoEl = $('plInfo');
  const camBox = $('plCam'), video = $<HTMLVideoElement>('plVideo'), camCv = $<HTMLCanvasElement>('plCamCv');
  const light = $('plLight'), meter = $('plMeter'), meterFill = $('plMeterFill');
  const debugEl = $('plDebug');
  const camG = camCv.getContext('2d')!;

  const keys = createKeys();
  const sound = createSound(readMuted());
  const settings = { sensitivity: 1 };
  let phase: Phase = 'ready';
  let module: GameModule | null = null;
  let instance: GameInstance | null = null;
  let camStream: MediaStream | null = null, micStream: MediaStream | null = null;
  let tracker: HandTracker | null = null, mic: MicMeter | null = null;
  let keyboardOnly = false, score = 0, countdownT = 0, lastShown = '';
  let micGranted = false;
  let raf = 0, last = performance.now();

  const loader = GAME_LOADERS[game.slug];
  const modulePromise: Promise<GameModule | null> = loader ? loader().catch(() => null) : Promise.resolve(null);

  /* ---------- overlay screens ---------- */
  function show(html: string, focus = '.pl-primary') {
    overlay.innerHTML = `<div class="pl-panel">${html}</div>`;
    overlay.hidden = false;
    overlay.querySelector<HTMLElement>(focus)?.focus();
  }
  function hide() {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  function showReady() {
    phase = 'ready';
    const slider = game.needs === 'mic'
      ? `<label class="pl-slider">Mic sensitivity <input type="range" id="plSens" min="0.5" max="2" step="0.1" value="${settings.sensitivity}"><output id="plSensOut">${settings.sensitivity.toFixed(1)}x</output></label>`
      : '';
    show(`
      <p class="pl-kicker">${game.input === 'rag' ? 'YOUR NOTES' : game.input.toUpperCase()} · ${esc(game.players.toUpperCase())}</p>
      <h1 class="pl-title" id="plTitle">${esc(game.title)}</h1>
      <ol class="pl-rules">${game.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
      <p class="pl-needs" data-need="${game.needs}">${esc(game.needsText ?? NEEDS_TEXT[game.needs])}</p>
      ${slider}
      <button type="button" class="pl-btn pl-primary pl-big" data-act="start">Start</button>
      <div class="pl-row">
        ${game.needs !== 'none' ? '<button type="button" class="pl-link" data-act="keyboard">Play with keyboard instead</button>' : ''}
        <a class="pl-link" href="/">Back to arcade</a>
      </div>
      ${keyboardHint ? `<p class="pl-small">${esc(keyboardHint)}</p>` : ''}`);
    const sens = overlay.querySelector<HTMLInputElement>('#plSens');
    sens?.addEventListener('input', () => {
      settings.sensitivity = Number(sens.value);
      overlay.querySelector('#plSensOut')!.textContent = settings.sensitivity.toFixed(1) + 'x';
    });
  }

  function showStarting(msg: string) {
    phase = 'starting';
    show(`<h2 class="pl-h" id="plTitle">${esc(game.title)}</h2><p class="pl-status blink-cur">${esc(msg)}</p>`);
  }

  function showError(msg: string) {
    phase = 'error';
    show(`
      <h2 class="pl-h" id="plTitle">That didn't work</h2>
      <p class="pl-err" role="alert">${esc(msg)}</p>
      <button type="button" class="pl-btn pl-primary" data-act="start">Start again</button>
      <div class="pl-row">
        ${game.needs !== 'none' ? '<button type="button" class="pl-link" data-act="keyboard">Play with keyboard instead</button>' : ''}
        <a class="pl-link" href="/">Back to arcade</a>
      </div>`);
  }

  function showPause() {
    phase = 'paused';
    instance?.pause?.();
    show(`
      <h2 class="pl-h" id="plTitle">Paused</h2>
      <div class="pl-stack">
        <button type="button" class="pl-btn pl-primary" data-act="resume">Resume</button>
        <button type="button" class="pl-btn" data-act="restart">Restart</button>
        <button type="button" class="pl-btn" data-act="rules">Rules</button>
        <button type="button" class="pl-btn" data-act="exit">Exit</button>
      </div>`);
  }

  function showOver(final: number, note?: string) {
    phase = 'over';
    const isNew = saveBest(game.slug, final);
    const best = getBest(game.slug);
    sound.beep(220, 0.3);
    show(`
      <h2 class="pl-title" id="plTitle">Game over</h2>
      ${note ? `<p class="pl-status">${esc(note)}</p>` : ''}
      <dl class="pl-scores"><div><dt>SCORE</dt><dd>${final}</dd></div><div><dt>BEST</dt><dd>${best}</dd></div></dl>
      ${isNew ? '<p class="pl-new">NEW BEST</p>' : ''}
      <button type="button" class="pl-btn pl-primary" data-act="restart">Retry</button>
      <div class="pl-row"><button type="button" class="pl-link" data-act="exit">Back to arcade</button></div>`);
  }

  /* ---------- start / stop ---------- */
  function stopMedia() {
    tracker?.stop();
    tracker = null;
    mic?.stop();
    mic = null;
    stopStream(camStream);
    stopStream(micStream);
    camStream = micStream = null;
    micGranted = false;
    video.srcObject = null;
    camBox.hidden = true;
    meter.hidden = true;
  }

  async function start(withKeyboard: boolean) {
    keyboardOnly = withKeyboard || game.needs === 'none';
    showStarting('Starting...');
    // Fullscreen needs the click that got us here, so ask for it first. Refused = play windowed.
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    }
    try {
      if (!keyboardOnly && game.needs === 'camera' && !tracker) {
        showStarting('Waiting for the camera...');
        camStream = await requestCamera();
        video.srcObject = camStream;
        await video.play();
        showStarting('Loading the hand model...');
        tracker = await startHandTracker(video, game.slug === 'apex-drive' ? 2 : 1);
        camBox.hidden = false;
      }
      if (!keyboardOnly && game.needs === 'mic' && !mic && !micGranted) {
        showStarting('Waiting for the microphone...');
        micStream = await requestMic();
        if (game.ownsMicInput) {
          // The game's own speech recognizer will reopen the device. Hand the mic back now:
          // a second AudioContext on the same input reads silence and never fires a result.
          micGranted = true;
          stopStream(micStream);
          micStream = null;
        } else {
          mic = startMic(micStream);
          meter.hidden = game.showMicMeter === false;
          if (game.calibrateMic !== false) {
            showStarting('Stay quiet for 2 seconds while we measure the room...');
            await mic.calibrate(2000);
          }
        }
      }
      module = await modulePromise;
      if (!module) throw new Error('This game is not in the cabinet yet. Pick another game from the arcade.');
      await newRun();
    } catch (err) {
      stopMedia();
      showError(err instanceof Error ? err.message : 'Something went wrong. Press Start again.');
    }
  }

  async function newRun() {
    instance?.destroy();
    instance = null;
    view.innerHTML = '';
    score = 0;
    setScore(0);
    infoEl.textContent = '';
    const ctx: GameContext = {
      game, view, keys, settings, debug, sound, reducedMotion,
      hand: keyboardOnly ? null : tracker?.state ?? null,
      mic: keyboardOnly ? null : mic,
      micGranted: !keyboardOnly && micGranted,
      setScore,
      setInfo: (t) => { if (infoEl.textContent !== t) infoEl.textContent = t; },
      gameOver: (s, note) => { if (phase === 'playing') { setScore(s); showOver(Math.floor(s), note); } },
    };
    instance = await module!.create(ctx);
    hud.hidden = false;
    if (module!.countdown === false) {
      hide();
      phase = 'playing';
    } else {
      phase = 'countdown';
      countdownT = 0;
      lastShown = '';
    }
  }

  function setScore(s: number) {
    score = Math.floor(s);
    const t = String(score);
    if (scoreEl.textContent !== t) scoreEl.textContent = t;
  }

  function resume() {
    if (phase !== 'paused') return;
    hide();
    instance?.resume?.();
    phase = 'playing';
    last = performance.now();
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    instance?.destroy();
    instance = null;
    stopMedia();
    keys.destroy();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }

  function exit() {
    cleanup();
    go('/');
  }

  /* ---------- actions ---------- */
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'start') void start(false);
    else if (act === 'keyboard') void start(true);
    else if (act === 'resume') resume();
    else if (act === 'restart') { if (module) void newRun(); }
    else if (act === 'exit') exit();
    else if (act === 'pause') { if (phase === 'playing') showPause(); else resume(); }
    else if (act === 'rules') {
      if (phase === 'playing') showPause();
      openPip({ ask: `How do I play ${game.title}?` });
    } else if (act === 'mute') {
      sound.muted = !sound.muted;
      btn.setAttribute('aria-pressed', String(sound.muted));
      btn.classList.toggle('is-off', sound.muted);
      try { localStorage.setItem('oa:muted', sound.muted ? '1' : '0'); } catch { /* not remembered */ }
    } else if (act === 'fullscreen') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  });
  const muteBtn = root.querySelector<HTMLElement>('[data-act="mute"]')!;
  muteBtn.setAttribute('aria-pressed', String(sound.muted));
  muteBtn.classList.toggle('is-off', sound.muted);

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || isPipOpen()) return;
    if (phase === 'playing') showPause();
    else if (phase === 'paused') resume();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'playing') showPause();
  });
  const portrait = window.matchMedia('(orientation: portrait) and (max-width: 820px)');
  portrait.addEventListener('change', () => {
    if (portrait.matches && phase === 'playing') showPause();
  });
  window.addEventListener('pagehide', cleanup);

  /* ---------- per-frame: game, countdown, preview, meter, debug ---------- */
  function drawPreview() {
    const st = tracker?.state;
    if (!st || camBox.hidden) return;
    const w = camCv.width, h = camCv.height;
    camG.save();
    camG.translate(w, 0);
    camG.scale(-1, 1);
    camG.drawImage(video, 0, 0, w, h);
    camG.restore();
    camG.fillStyle = '#19f0ff';
    const tracked = st.hands?.length ? st.hands.flatMap((hand) => hand.landmarks) : st.landmarks;
    for (const p of tracked) camG.fillRect(p.x * w - 1.5, p.y * h - 1.5, 3, 3);
    if (debug && st.landmarks.length) {
      camG.fillStyle = '#ffe14a';
      camG.fillRect(st.x * w - 3, st.y * h - 3, 6, 6);
    }
    const label = st.present ? `HAND · ${st.gesture.toUpperCase()}` : 'NO HAND';
    if (light.textContent !== label) {
      light.textContent = label;
      light.classList.toggle('on', st.present);
    }
  }

  function drawMeter() {
    if (!mic || meter.hidden) return;
    const loud = mic.loudness(settings.sensitivity);
    meterFill.style.height = `${Math.round(loud * 100)}%`;
  }

  function drawDebug() {
    if (!debug) return;
    debugEl.hidden = false;
    const st = tracker?.state;
    const lines = [`phase ${phase}  input ${keyboardOnly ? 'keyboard' : game.needs}`];
    if (st) lines.push(
      `hand present ${st.present}  fps ${st.fps}`,
      `x ${st.x.toFixed(3)}  y ${st.y.toFixed(3)}  tilt ${st.tilt.toFixed(2)}`,
      `gesture ${st.gesture}  conf ${st.confidence.toFixed(2)}  jumps ${st.jumpEvent}`,
    );
    if (mic) lines.push(
      `mic level ${mic.state.level.toFixed(4)}  smoothed ${mic.state.smoothed.toFixed(4)}`,
      `noiseFloor ${mic.state.noiseFloor.toFixed(4)}  loudness ${mic.loudness(settings.sensitivity).toFixed(2)}`,
    );
    debugEl.textContent = lines.join('\n');
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (phase === 'countdown') {
      countdownT += dt;
      const n = 3 - Math.floor(countdownT / 0.8);
      const label = n > 0 ? String(n) : 'GO';
      if (label !== lastShown) {
        lastShown = label;
        overlay.hidden = false;
        overlay.innerHTML = `<div class="pl-count${reducedMotion ? '' : ' pop'}" aria-live="assertive">${label}</div>`;
        sound.beep(n > 0 ? 440 : 880, 0.12);
      }
      if (countdownT >= 2.8) {
        hide();
        phase = 'playing';
      }
    } else if (phase === 'playing' && instance) {
      instance.update(dt);
    }
    drawPreview();
    drawMeter();
    drawDebug();
  }

  showReady();
  raf = requestAnimationFrame(frame);
}
