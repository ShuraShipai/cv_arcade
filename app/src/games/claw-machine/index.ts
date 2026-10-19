// Claw Machine: a 3D mall prize crane driven by five commands — UP, DOWN, LEFT, RIGHT and
// GRAB. Voice uses the pretrained speech-commands model; keyboard and the on-screen pad are
// always live so the game stays playable without a microphone.
// The rules live in logic.ts (pure, head-less testable); this file is input and rendering.
import * as THREE from 'three';
import type { GameContext, GameInstance } from '../../play/types';
import {
  CHUTE, FLOOR_Y, RAIL_Y, START_CREDITS, VOICE_WORDS,
  buildPrizes, createClawState, startGrab, step, voiceThreshold,
  type Action, type ClawState, type Input, type Prize,
} from './logic';
import './claw.css';

export const countdown = true;

/**
 * Loads the pretrained 18-word browser speech-commands model (TensorFlow.js). It ships the
 * five words this game needs: up, down, left, right and "go" (mapped to GRAB).
 */
async function loadVoiceModel() {
  const [{ ready, setBackend }, speechCommands] = await Promise.all([
    import('@tensorflow/tfjs'),
    import('@tensorflow-models/speech-commands'),
  ]);
  try {
    if (!(await setBackend('webgl'))) await setBackend('cpu');
  } catch {
    await setBackend('cpu');
  }
  await ready();
  const recognizer = speechCommands.create('BROWSER_FFT', '18w');
  await recognizer.ensureModelLoaded();
  return recognizer;
}

export function create(ctx: GameContext): GameInstance {
  const host = document.createElement('div');
  host.className = 'cm-game';
  host.innerHTML = `
    <div class="cm-scene" aria-label="Three dimensional claw machine cabinet"></div>
    <div class="cm-topline">
      <span class="cm-brand">PRIZE <b>CLAW</b></span>
      <span class="cm-stat">CREDITS <b data-credits>${START_CREDITS}</b></span>
      <span class="cm-stat">TIME <b data-timer>1:30</b></span>
      <span class="cm-stat">PRIZES <b data-won>0</b></span>
    </div>
    <div class="cm-message" data-message role="status">MOVE THE CLAW OVER A PRIZE, THEN GRAB</div>
    <div class="cm-panel">
      <div class="cm-voice">
        <div class="cm-voice-row"><span class="cm-dot" data-dot></span><b data-voice>VOICE · STARTING</b></div>
        <div class="cm-level"><i data-level></i></div>
        <button type="button" class="cm-voice-btn" data-voiceaction hidden>START VOICE CONTROLS</button>
        <small>SAY: LEFT · RIGHT · UP · DOWN · GO TO GRAB</small>
      </div>
      <div class="cm-pad" role="group" aria-label="Claw controls">
        <button type="button" class="cm-key cm-up" data-action="up"><span>UP</span><small>BACK</small></button>
        <button type="button" class="cm-key cm-left" data-action="left"><span>LEFT</span></button>
        <button type="button" class="cm-key cm-grab" data-action="grab"><span>GRAB</span><small>HOLD</small></button>
        <button type="button" class="cm-key cm-right" data-action="right"><span>RIGHT</span></button>
        <button type="button" class="cm-key cm-down" data-action="down"><span>DOWN</span><small>FRONT</small></button>
      </div>
      <div class="cm-readout">
        <span>LAST PRIZE <b data-last>NONE</b></span>
        <span>CLAW <b data-state>READY</b></span>
        <span>BEST <b data-best>0 PTS</b></span>
        <small>W/UP BACK · S/DOWN FRONT · A/D OR ARROWS SIDE · SPACE GRAB</small>
      </div>
    </div>`;
  ctx.view.appendChild(host);

  const $ = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
  const sceneEl = $<HTMLElement>('.cm-scene');
  const messageEl = $<HTMLElement>('[data-message]');
  const voiceEl = $<HTMLElement>('[data-voice]');
  const voiceBtn = $<HTMLButtonElement>('[data-voiceaction]');
  const dotEl = $<HTMLElement>('[data-dot]');
  const levelEl = $<HTMLElement>('[data-level]');
  const stateEl = $<HTMLElement>('[data-state]');
  const lastEl = $<HTMLElement>('[data-last]');
  const bestEl = $<HTMLElement>('[data-best]');
  const creditsEl = $<HTMLElement>('[data-credits]');
  const timerEl = $<HTMLElement>('[data-timer]');
  const wonEl = $<HTMLElement>('[data-won]');

  /* ---------------- three.js cabinet ---------------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#120a24');
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 100);
  camera.position.set(0, 6.4, 12.4);
  camera.lookAt(0, 3.1, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(sceneEl.clientWidth || 640, sceneEl.clientHeight || 360);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  sceneEl.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight('#cfd6ff', '#241840', 1.5));
  const key = new THREE.DirectionalLight('#fff3dc', 2.0);
  key.position.set(5, 12, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  scene.add(key);
  // Two marquee spots give the glass box its arcade glow.
  for (const [x, color] of [[-3.4, '#ff2bd6'], [3.4, '#19f0ff']] as const) {
    const spot = new THREE.PointLight(color, 42, 18, 2);
    spot.position.set(x, 6.6, 1.4);
    scene.add(spot);
  }

  const cabinet = new THREE.Group();
  scene.add(cabinet);

  const bodyMat = new THREE.MeshStandardMaterial({ color: '#d62a66', metalness: 0.42, roughness: 0.36 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#ffe14a', metalness: 0.6, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1230', metalness: 0.3, roughness: 0.6 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#b9eaff', metalness: 0, roughness: 0.04,
    transmission: 0.82, thickness: 0.4, transparent: true, opacity: 0.22,
    side: THREE.DoubleSide,
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#b6c0d2', metalness: 0.9, roughness: 0.22 });

  const addBox = (
    parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number],
    mat: THREE.Material, shadow = true,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...pos);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    parent.add(mesh);
    return mesh;
  };

  // Base cabinet, pit floor and the four corner pillars holding the glass.
  addBox(cabinet, [8.6, 1.5, 6.6], [0, -0.45, 0], bodyMat);
  addBox(cabinet, [9.0, 0.22, 7.0], [0, 0.33, 0], trimMat);
  addBox(cabinet, [8.0, 0.12, 6.0], [0, FLOOR_Y - 0.06, 0], new THREE.MeshStandardMaterial({ color: '#2b1c4d', roughness: 0.85 }));
  for (const px of [-4.1, 4.1]) {
    for (const pz of [-3.1, 3.1]) addBox(cabinet, [0.26, 5.6, 0.26], [px, 3.15, pz], bodyMat);
  }
  // Glass panes: back, front and both sides.
  addBox(cabinet, [8.2, 5.4, 0.06], [0, 3.1, -3.1], glassMat, false);
  addBox(cabinet, [8.2, 5.4, 0.06], [0, 3.1, 3.1], glassMat, false);
  addBox(cabinet, [0.06, 5.4, 6.1], [-4.1, 3.1, 0], glassMat, false);
  addBox(cabinet, [0.06, 5.4, 6.1], [4.1, 3.1, 0], glassMat, false);
  // Marquee crown.
  addBox(cabinet, [9.0, 1.0, 7.0], [0, 6.3, 0], bodyMat);
  addBox(cabinet, [8.4, 0.4, 0.14], [0, 6.35, 3.3], new THREE.MeshStandardMaterial({ color: '#ffe14a', emissive: '#ff8a3d', emissiveIntensity: 1.5 }), false);

  // Prize chute: an opening in the front-left corner with a lit collection tray.
  const chute = new THREE.Group();
  chute.position.set(CHUTE.x, 0, CHUTE.z);
  cabinet.add(chute);
  addBox(chute, [1.5, 0.08, 1.5], [0, FLOOR_Y - 0.26, 0], new THREE.MeshStandardMaterial({ color: '#0d0820', roughness: 0.95 }), false);
  for (const [ox, oz, sx, sz] of [[0, -0.78, 1.6, 0.1], [-0.78, 0, 0.1, 1.6]] as const) {
    addBox(chute, [sx, 0.34, sz], [ox, FLOOR_Y + 0.1, oz], trimMat, false);
  }
  const chuteGlow = new THREE.PointLight('#ffe14a', 10, 4, 2);
  chuteGlow.position.set(0, 1.1, 0);
  chute.add(chuteGlow);

  // Gantry: a rail across X that itself slides along Z, with the claw hanging beneath it.
  const railZ = new THREE.Group();
  cabinet.add(railZ);
  const railBar = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.18, 0.18), steelMat);
  railBar.position.set(0, RAIL_Y, 0);
  railBar.castShadow = true;
  railZ.add(railBar);
  const trolley = new THREE.Group();
  railZ.add(trolley);
  addBox(trolley, [0.72, 0.42, 0.62], [0, RAIL_Y, 0], darkMat);
  addBox(trolley, [0.86, 0.1, 0.72], [0, RAIL_Y + 0.26, 0], steelMat);

  // Cable + claw head. The head moves only on Y; the trolley carries X and Z.
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), steelMat);
  trolley.add(cable);
  const clawHead = new THREE.Group();
  trolley.add(clawHead);
  addBox(clawHead, [0.62, 0.3, 0.62], [0, 0, 0], steelMat);
  addBox(clawHead, [0.42, 0.18, 0.42], [0, 0.22, 0], trimMat);
  const fingers: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 3) * Math.PI * 2;
    clawHead.add(pivot);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.62, 0.17), steelMat);
    upper.position.set(0, -0.32, 0.2);
    upper.castShadow = true;
    pivot.add(upper);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.15), steelMat);
    lower.position.set(0, -0.58, 0.07);
    lower.rotation.x = -0.75;
    upper.add(lower);
    fingers.push(pivot);
  }

  /* ---------------- prizes ---------------- */
  const prizeMeshes = new Map<number, THREE.Group>();
  function buildPrizeMesh(p: Prize): THREE.Group {
    const root = new THREE.Group();
    const plushMat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.82, metalness: 0.02 });
    const accentMat = new THREE.MeshStandardMaterial({ color: p.accent, roughness: 0.7 });
    const r = p.radius;
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), plushMat);
    body.scale.set(1, 0.92, 0.9);
    body.castShadow = true;
    root.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.66, 16, 12), plushMat);
    head.position.set(0, r * 0.95, 0);
    head.castShadow = true;
    root.add(head);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(r * 0.56, 12, 10), accentMat);
    belly.position.set(0, -r * 0.05, r * 0.42);
    belly.scale.set(1, 0.9, 0.5);
    root.add(belly);
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#17121f' });
    for (const ex of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(r * 0.26, 10, 8), plushMat);
      ear.position.set(ex * r * 0.48, r * 1.42, 0);
      root.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 8, 6), eyeMat);
      eye.position.set(ex * r * 0.22, r * 1.02, r * 0.56);
      root.add(eye);
      const arm = new THREE.Mesh(new THREE.SphereGeometry(r * 0.26, 10, 8), plushMat);
      arm.position.set(ex * r * 0.86, 0, r * 0.1);
      arm.scale.set(0.8, 0.7, 0.8);
      root.add(arm);
    }
    const snout = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 10, 8), accentMat);
    snout.position.set(0, r * 0.85, r * 0.62);
    root.add(snout);
    root.rotation.y = Math.random() * Math.PI * 2;
    cabinet.add(root);
    return root;
  }

  const state: ClawState = createClawState(buildPrizes());
  state.reachScale = ctx.settings.sensitivity;
  for (const p of state.prizes) prizeMeshes.set(p.id, buildPrizeMesh(p));

  /* ---------------- input ---------------- */
  // Directions are held; a tap or a spoken word adds a short timed nudge.
  const pressed = new Set<Action>();
  const nudges = new Map<Action, number>();
  let messageT = 0;

  function say(text: string, hold = 2) {
    messageEl.textContent = text;
    messageT = hold;
  }

  function trigger(action: Action, nudgeFor = 0.14) {
    if (state.ended) return;
    if (action === 'grab') {
      const event = startGrab(state);
      if (!event) return;
      if (event.type === 'no-credits') { say('NO CREDITS LEFT', 2); return; }
      creditsEl.textContent = String(state.credits);
      ctx.sound.beep(520, 0.1);
      say('CLAW DESCENDING', 1.4);
    } else {
      nudges.set(action, Math.max(nudges.get(action) ?? 0, nudgeFor));
    }
  }

  host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    const action = btn.dataset.action as Action;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      if (action === 'grab') trigger('grab');
      else pressed.add(action);
    };
    const up = () => { if (action !== 'grab') pressed.delete(action); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
  });
  const onBlur = () => pressed.clear();
  window.addEventListener('blur', onBlur);

  /* ---------------- voice ---------------- */
  type Recognizer = Awaited<ReturnType<typeof loadVoiceModel>>;
  let recognizer: Recognizer | null = null;
  let listening = false, voiceBusy = false;
  let lastVoiceAt = 0, lastResultAt = 0;
  /** Best match from the most recent listening window, for the confidence bar. */
  let lastScore = 0, lastWord = '';
  let voiceLabel = 'VOICE · STARTING';
  const voiceAvailable = ctx.micGranted;

  function setVoice(label: string, live = false) {
    voiceLabel = label;
    voiceEl.textContent = label;
    dotEl.classList.toggle('is-live', live);
  }

  async function prepareVoiceModel() {
    if (!voiceAvailable) { setVoice('KEYBOARD MODE · PAD + KEYS'); voiceBtn.hidden = true; return; }
    voiceBusy = true;
    voiceBtn.hidden = true;
    setVoice('LOADING COMMAND MODEL');
    try {
      recognizer = await loadVoiceModel();
      setVoice('MODEL READY · TAP START VOICE CONTROLS');
      voiceBtn.textContent = 'START VOICE CONTROLS';
    } catch (error) {
      recognizer = null;
      const detail = error instanceof Error ? error.message : 'DOWNLOAD FAILED';
      setVoice(`MODEL FAILED · ${detail.slice(0, 36).toUpperCase()} · USE KEYS`);
      voiceBtn.textContent = 'RETRY COMMAND MODEL';
    } finally {
      voiceBusy = false;
      voiceBtn.disabled = false;
      voiceBtn.hidden = false;
    }
  }

  async function startVoiceControls() {
    if (voiceBusy) return;
    if (!recognizer) { await prepareVoiceModel(); return; }
    voiceBusy = true;
    voiceBtn.disabled = true;
    setVoice('OPENING MICROPHONE');
    try {
      // probabilityThreshold 0 means every window reaches us, so the bar can show near
      // misses instead of the game going quiet with no explanation.
      await recognizer.listen(async (result) => {
        if (state.ended || !recognizer) return;
        const labels = recognizer.wordLabels();
        const scores = result.scores instanceof Float32Array ? result.scores : result.scores[0];
        if (!scores?.length) return;
        lastResultAt = performance.now();
        // Rank the five words we act on, ignoring digits, "yes/no" and background noise.
        let bestWord = '', bestScore = 0;
        for (let i = 0; i < scores.length; i++) {
          if (!VOICE_WORDS[labels[i]]) continue;
          if (scores[i] > bestScore) { bestScore = scores[i]; bestWord = labels[i]; }
        }
        lastScore = bestScore;
        lastWord = bestWord;
        if (!bestWord) return;
        const threshold = voiceThreshold(ctx.settings.sensitivity);
        const now = performance.now();
        if (bestScore < threshold) {
          setVoice(`${bestWord.toUpperCase()} ${Math.round(bestScore * 100)}% · NEED ${Math.round(threshold * 100)}%`, true);
          return;
        }
        if (now - lastVoiceAt < 650) return;
        lastVoiceAt = now;
        // A spoken direction is one nudge, held a little longer than a key tap.
        trigger(VOICE_WORDS[bestWord], 0.42);
        setVoice(`HEARD ${bestWord.toUpperCase()} · ${Math.round(bestScore * 100)}%`, true);
      }, { probabilityThreshold: 0, overlapFactor: 0.5, suppressionTimeMillis: 400 });
      listening = true;
      lastResultAt = performance.now();
      voiceBtn.hidden = true;
      setVoice('MIC LIVE · SAY LEFT RIGHT UP DOWN GO', true);
    } catch (error) {
      listening = false;
      voiceBtn.disabled = false;
      voiceBtn.textContent = 'RETRY VOICE CONTROLS';
      voiceBtn.hidden = false;
      const detail = error instanceof Error ? error.message : 'MIC ERROR';
      setVoice(`VOICE FAILED · ${detail.slice(0, 36).toUpperCase()} · USE KEYS`);
    } finally {
      voiceBusy = false;
    }
  }

  voiceBtn.addEventListener('click', () => { void startVoiceControls(); });
  if (voiceAvailable) void prepareVoiceModel();
  else setVoice('KEYBOARD MODE · PAD + KEYS');

  /* ---------------- resize ---------------- */
  const resize = () => {
    const w = sceneEl.clientWidth, h = sceneEl.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(sceneEl);

  const bestKey = 'oa:best:claw-machine';
  try { bestEl.textContent = `${Math.floor(Number(localStorage.getItem(bestKey) || 0))} PTS`; } catch { bestEl.textContent = '0 PTS'; }
  function recordScore(final: number) {
    try {
      const best = Math.max(final, Number(localStorage.getItem(bestKey) || 0));
      localStorage.setItem(bestKey, String(best));
      bestEl.textContent = `${best} PTS`;
    } catch { /* storage may be unavailable */ }
  }

  const PHASE_LABEL: Record<ClawState['phase'], string> = {
    move: 'READY', lower: 'LOWERING', close: 'CLOSING',
    lift: 'LIFTING', return: 'CARRYING TO CHUTE', release: 'DROPPING PRIZE', reset: 'RESETTING',
  };

  /* ---------------- per-frame ---------------- */
  function update(dt: number) {
    if (state.ended) { renderer.render(scene, camera); return; }
    messageT = Math.max(0, messageT - dt);
    // The bar tracks how well the last window matched one of the five words. We no longer
    // hold a mic stream of our own, so there is no raw level to show.
    levelEl.style.transform = `scaleX(${Math.min(1, lastScore)})`;
    levelEl.classList.toggle('is-hot', lastScore >= voiceThreshold(ctx.settings.sensitivity));
    // A listening recognizer that stops delivering windows means the audio path died.
    if (listening && performance.now() - lastResultAt > 6000) {
      listening = false;
      setVoice('NO AUDIO FROM THE MIC · USE KEYS OR RETRY');
      voiceBtn.textContent = 'RETRY VOICE CONTROLS';
      voiceBtn.disabled = false;
      voiceBtn.hidden = false;
    }
    state.reachScale = ctx.settings.sensitivity;

    if (ctx.keys.pressed('Space') || ctx.keys.pressed('Enter')) trigger('grab');
    for (const [action, left] of nudges) {
      const next = left - dt;
      if (next <= 0) nudges.delete(action); else nudges.set(action, next);
    }
    const input: Input = {
      up: ctx.keys.down('ArrowUp') || ctx.keys.down('KeyW') || pressed.has('up') || nudges.has('up'),
      down: ctx.keys.down('ArrowDown') || ctx.keys.down('KeyS') || pressed.has('down') || nudges.has('down'),
      left: ctx.keys.down('ArrowLeft') || ctx.keys.down('KeyA') || pressed.has('left') || nudges.has('left'),
      right: ctx.keys.down('ArrowRight') || ctx.keys.down('KeyD') || pressed.has('right') || nudges.has('right'),
    };

    for (const event of step(state, dt, input)) {
      if (event.type === 'grabbed' && event.prize) {
        ctx.sound.beep(880, 0.12);
        say(`GRABBED ${event.prize.name}`, 2);
      } else if (event.type === 'missed') {
        ctx.sound.beep(190, 0.16);
        say('THE CLAW CAME UP EMPTY', 2);
      } else if (event.type === 'scored' && event.prize) {
        ctx.sound.beep(1180, 0.18);
        say(`${event.prize.name} IN THE CHUTE · +${event.prize.value}`, 2.4);
        lastEl.textContent = event.prize.name;
        wonEl.textContent = String(state.won);
      } else if (event.type === 'over') {
        recordScore(state.score);
        ctx.gameOver(state.score, event.note);
      }
    }
    // Directions never queue up across a grab sequence.
    if (state.phase !== 'move') { pressed.clear(); nudges.clear(); }

    /* ---- transforms ---- */
    trolley.position.x = state.x;
    railZ.position.z = state.z;
    clawHead.position.y = state.y - RAIL_Y;
    const cableLen = Math.max(0.1, RAIL_Y - state.y);
    cable.scale.y = cableLen;
    cable.position.set(0, RAIL_Y - cableLen / 2, 0);
    for (const finger of fingers) finger.rotation.x = -0.62 * state.fingerOpen + 0.18;
    for (const p of state.prizes) {
      const mesh = prizeMeshes.get(p.id);
      if (!mesh) continue;
      mesh.position.set(p.x, p.y, p.z);
      if (p.held) mesh.rotation.z = Math.sin(state.phaseT * 6) * 0.08;
      else if (p.collected) mesh.scale.setScalar(Math.max(0.55, mesh.scale.x - dt * 0.4));
    }

    /* ---- HUD ---- */
    stateEl.textContent = PHASE_LABEL[state.phase];
    timerEl.textContent = `${Math.floor(state.timeLeft / 60)}:${String(Math.floor(state.timeLeft % 60)).padStart(2, '0')}`;
    if (messageT <= 0) {
      messageEl.textContent = state.phase === 'move'
        ? (listening ? 'SAY LEFT RIGHT UP DOWN · SAY GO TO GRAB' : 'MOVE THE CLAW OVER A PRIZE, THEN GRAB')
        : voiceLabel;
    }
    ctx.setScore(state.score);
    ctx.setInfo(`PRIZES ${state.won} · CREDITS ${state.credits}`);
    renderer.render(scene, camera);
  }

  return {
    update,
    destroy() {
      state.ended = true;
      observer.disconnect();
      window.removeEventListener('blur', onBlur);
      if (recognizer?.isListening()) void recognizer.stopListening().catch(() => undefined);
      recognizer = null;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
        else if (mesh.material) mesh.material.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      host.remove();
    },
  };
}
