// Apex Drive: a low-poly night circuit with continuous steering, pedals and hand input.
import * as THREE from 'three';
import type { GameContext, GameInstance } from '../../play/types';
import {
  LAP_LENGTH, TRACK_LENGTH, cornering, createDriveState, lap as lapOf,
  passObstacle, score as scoreOf, stepDrive, trackCurve,
} from './physics';
import './racer.css';

export const countdown = true;

type Obstacle = { root: THREE.Group; x: number; z: number; hit: boolean };

export function create(ctx: GameContext): GameInstance {
  const host = document.createElement('div');
  host.className = 'ad-game';
  host.innerHTML = `
    <div class="ad-scene" aria-label="Three dimensional night racing circuit"></div>
    <div class="ad-topline"><span class="ad-brand">APEX <b>DRIVE</b></span><span class="ad-track">3 LAP HEAD-TO-HEAD</span><span class="ad-condition">CAR <b data-condition>100%</b></span></div>
    <div class="ad-race-progress"><div class="ad-race-track"><i data-rivalbar></i><b data-playerbar></b></div><span data-race-state>YOU vs RIVAL</span><span data-lap>LAP 1 / 3</span><span data-race-time>00:00</span></div>
    <div class="ad-speed"><strong data-speed>000</strong><span>KM/H</span><div class="ad-speed-track"><i data-speedbar></i></div></div>
    <div class="ad-message" data-message role="status">BEAT THE RIVAL · BRAKE FOR CORNERS · AVOID TRAFFIC</div>
    <div class="ad-dash">
      <div class="ad-wheel-box"><div class="ad-wheel" data-wheel aria-label="Steering wheel"><span></span><i></i><b></b></div><small data-steer-value>CAMERA STEERING · CENTER</small><button type="button" data-calibrate>CALIBRATE HANDS</button></div>
      <div class="ad-controls">
        <div class="ad-input"><span class="ad-dot"></span><b data-tracking>CAMERA · WAITING</b><small data-active>KEYBOARD / PEDALS</small></div>
        <div class="ad-hand-help">CAMERA: MOVE HANDS TO STEER · PALMS = GAS · FISTS = BRAKE · SLOW FOR CORNERS</div>
        <div class="ad-pedals">
          <button type="button" class="ad-pedal ad-brake" data-pedal="brake"><span>BRAKE</span><b>PRESS</b></button>
          <button type="button" class="ad-pedal ad-gas" data-pedal="gas"><span>ACCELERATOR</span><b>PRESS</b></button>
        </div>
        <div class="ad-key-hint">A / D STEER <i>·</i> W ACCELERATE <i>·</i> S / SPACE BRAKE</div>
      </div>
      <div class="ad-telemetry"><span>DISTANCE <b data-distance>0.0 KM</b></span><span>BEST RUN <b data-best>0 PTS</b></span><div class="ad-condition-bar"><i data-conditionbar></i></div><small>0 CONDITION = WRECK</small></div>
    </div>`;
  ctx.view.appendChild(host);
  const sceneEl = host.querySelector<HTMLElement>('.ad-scene')!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#10172a');
  scene.fog = new THREE.Fog('#10172a', 45, 190);
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.1, 300);
  camera.position.set(0, 5.5, 11.5);
  camera.lookAt(0, 1, -14);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(sceneEl.clientWidth || 640, sceneEl.clientHeight || 360);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  sceneEl.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight('#b5d6ff', '#222036', 2.1));
  const moon = new THREE.DirectionalLight('#d6e6ff', 2.4);
  moon.position.set(-8, 18, 7); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); scene.add(moon);
  const roadMat = new THREE.MeshStandardMaterial({ color: '#292f3b', roughness: 0.9 });
  const ROAD_SCALE = 2.35, ROAD_SEGMENTS = 48;
  const car$ = createDriveState();
  const trackOffset = (z: number) => trackCurve(car$.distance + Math.max(-z, 0) * ROAD_SCALE) - trackCurve(car$.distance);
  const roadGeo = new THREE.BufferGeometry();
  const roadPositions = new Float32Array((ROAD_SEGMENTS + 1) * 2 * 3);
  const roadIndices: number[] = [];
  for (let i = 0; i < ROAD_SEGMENTS; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    roadIndices.push(a, b, c, b, d, c);
  }
  roadGeo.setAttribute('position', new THREE.BufferAttribute(roadPositions, 3));
  roadGeo.setIndex(roadIndices);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true; scene.add(road);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#101720', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.18, -100); scene.add(floor);

  const edgePositions = [-7.6, 7.6].map(() => new Float32Array((ROAD_SEGMENTS + 1) * 2 * 3));
  const edgeMeshes = [-7.6, 7.6].map((edge, index) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(edgePositions[index], 3));
    geo.setIndex(roadIndices);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#e6c878', side: THREE.DoubleSide }));
    scene.add(mesh); return { mesh, edge };
  });
  const dashes: THREE.Mesh[] = [];
  for (let i = 0; i < 24; i++) {
    for (const x of [-2.55, 2.55]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.028, 3.6), new THREE.MeshBasicMaterial({ color: '#d4dae4' }));
      d.position.set(x, 0.015, -i * 9); scene.add(d); dashes.push(d);
    }
  }
  const posts: THREE.Group[] = [];
  for (let i = 0; i < 18; i++) {
    const post = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 3.2, 7), new THREE.MeshStandardMaterial({ color: '#454d5b', metalness: 0.65, roughness: 0.5 }));
    pole.position.y = 1.6; post.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe5a1' })); lamp.position.set(0, 3.25, 0); post.add(lamp);
    const glow = new THREE.PointLight('#ffd99a', 18, 17, 2); glow.position.set(0, 3, 0); post.add(glow);
    post.position.set(i % 2 ? 9.5 : -9.5, 0, -i * 13); scene.add(post); posts.push(post);
  }

  // A readable sports coupe built from shaded body panels, glazed cabin, wheels and lights.
  const car = new THREE.Group(); scene.add(car); car.position.set(0, 0.28, 0);
  const paint = new THREE.MeshStandardMaterial({ color: '#d82e4e', metalness: 0.72, roughness: 0.24 });
  const darkPaint = new THREE.MeshStandardMaterial({ color: '#7d1730', metalness: 0.55, roughness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: '#152a3c', metalness: 0.42, roughness: 0.14, transparent: true, opacity: 0.88 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#101216', roughness: 0.82 });
  const alloy = new THREE.MeshStandardMaterial({ color: '#a8b4c2', metalness: 0.84, roughness: 0.25 });
  const addBox = (parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], mat: THREE.Material, bevel = false) => {
    const mesh = new THREE.Mesh(bevel ? new THREE.BoxGeometry(...size, 2, 0.12) : new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  addBox(car, [2.35, 0.48, 4.5], [0, 0.65, 0], paint, true);
  addBox(car, [2.08, 0.32, 1.22], [0, 0.88, 1.55], darkPaint, true);
  addBox(car, [1.78, 0.78, 1.82], [0, 1.19, -0.18], glass, true);
  addBox(car, [1.86, 0.13, 1.9], [0, 1.59, -0.2], paint);
  addBox(car, [1.98, 0.16, 0.1], [0, 1.06, -1.19], darkPaint);
  addBox(car, [2.2, 0.12, 0.45], [0, 0.83, -2.15], paint);
  addBox(car, [2.18, 0.1, 0.15], [0, 1.18, -2.13], darkPaint);
  const headMat = new THREE.MeshStandardMaterial({ color: '#fff4d2', emissive: '#ffe5a3', emissiveIntensity: 2 });
  for (const x of [-0.83, 0.83]) {
    addBox(car, [0.48, 0.16, 0.08], [x, 0.76, -2.24], headMat);
    addBox(car, [0.42, 0.15, 0.08], [x, 0.75, 2.24], new THREE.MeshStandardMaterial({ color: '#ff304a', emissive: '#bc1024', emissiveIntensity: 1.4 }));
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.3, 20), rubber);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(x < 0 ? -1.12 : 1.12, 0.47, -1.38); wheel.castShadow = true; car.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.32, 16), alloy); hub.rotation.z = Math.PI / 2; hub.position.copy(wheel.position); car.add(hub);
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.8), new THREE.MeshBasicMaterial({ color: '#e82f55', transparent: true, opacity: 0.1, side: THREE.DoubleSide }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02; car.add(glow);
  const rival = car.clone(true);
  const rivalPaint = new THREE.MeshStandardMaterial({ color: '#2389a8', metalness: 0.72, roughness: 0.24 });
  rival.traverse((obj) => { const mesh = obj as THREE.Mesh; if (mesh.material === paint) mesh.material = rivalPaint; });
  rival.scale.setScalar(0.84); scene.add(rival);

  const obstacleMat = new THREE.MeshStandardMaterial({ color: '#e7a73e', metalness: 0.3, roughness: 0.42 });
  const obstacles: Obstacle[] = [];
  const lanes = [-5.1, 0, 5.1];
  function makeObstacle(z: number, lane: number): Obstacle {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.25, 3.4), obstacleMat); body.position.y = 0.78; body.castShadow = true; group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.72, 1.45), new THREE.MeshStandardMaterial({ color: '#344858', metalness: 0.3, roughness: 0.2 })); cabin.position.set(0, 1.68, -0.18); group.add(cabin);
    group.position.set(lane, 0, z); scene.add(group);
    const o = { root: group, x: lane, z, hit: false }; obstacles.push(o); return o;
  }
  // Keep traffic readable and leave more time between cars, especially for camera steering.
  for (let i = 0; i < 6; i++) makeObstacle(-55 - i * 30, lanes[Math.floor(Math.random() * lanes.length)]);

  const $ = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
  const wheelEl = $<HTMLElement>('[data-wheel]'), message = $<HTMLElement>('[data-message]');
  const tracking = $<HTMLElement>('[data-tracking]'), active = $<HTMLElement>('[data-active]');
  const bestEl = $<HTMLElement>('[data-best]');
  let wheelAngle = 0;
  let handNeutral = 0.5, handSeen = 0, collisionFlash = 0;
  let gasPointer = false, brakePointer = false;
  const bestKey = 'oa:best:apex-drive';
  try { bestEl.textContent = `${Math.floor(Number(localStorage.getItem(bestKey) || 0))} PTS`; } catch { bestEl.textContent = '0 PTS'; }

  const calBtn = $<HTMLButtonElement>('[data-calibrate]');
  calBtn.addEventListener('click', () => {
    if (ctx.hand?.present) { handNeutral = averageHandX(); message.textContent = 'STEERING CENTER SET'; }
    else message.textContent = 'SHOW BOTH HANDS IN THE CAMERA PREVIEW FIRST';
  });
  function averageHandX(): number {
    const hands = ctx.hand?.hands?.filter((h) => h.confidence > 0.35) ?? [];
    if (hands.length >= 2) return (hands[0].x + hands[1].x) / 2;
    return ctx.hand?.x ?? 0.5;
  }
  host.querySelectorAll<HTMLButtonElement>('[data-pedal]').forEach((button) => {
    const gas = button.dataset.pedal === 'gas';
    const down = (e: PointerEvent) => { e.preventDefault(); if (gas) gasPointer = true; else brakePointer = true; button.setPointerCapture(e.pointerId); };
    const up = () => { if (gas) gasPointer = false; else brakePointer = false; };
    button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up);
  });
  const onBlur = () => { gasPointer = brakePointer = false; };
  window.addEventListener('blur', onBlur);

  const sphere = new THREE.SphereGeometry(0.32, 12, 8);
  const coneMat = new THREE.MeshStandardMaterial({ color: '#fa4c68', emissive: '#64102a', emissiveIntensity: 0.7 });
  for (const o of obstacles) { const marker = new THREE.Mesh(sphere, coneMat); marker.position.set(0, 0.18, 0); o.root.add(marker); }
  const resize = () => {
    const w = sceneEl.clientWidth, h = sceneEl.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(sceneEl);

  function updateTrack() {
    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      const z = 14 - i * 5, offset = trackOffset(z), base = i * 6;
      roadPositions[base] = offset - 8; roadPositions[base + 1] = -0.06; roadPositions[base + 2] = z;
      roadPositions[base + 3] = offset + 8; roadPositions[base + 4] = -0.06; roadPositions[base + 5] = z;
      for (let j = 0; j < edgeMeshes.length; j++) {
        const edge = edgeMeshes[j].edge, positions = edgePositions[j];
        positions[base] = offset + edge - 0.08; positions[base + 1] = 0.012; positions[base + 2] = z;
        positions[base + 3] = offset + edge + 0.08; positions[base + 4] = 0.012; positions[base + 5] = z;
      }
    }
    roadGeo.attributes.position.needsUpdate = true; roadGeo.computeVertexNormals();
    edgeMeshes.forEach((entry) => { entry.mesh.geometry.attributes.position.needsUpdate = true; entry.mesh.geometry.computeVertexNormals(); });
  }

  function recordScore(score: number) {
    try {
      const best = Math.max(score, Number(localStorage.getItem(bestKey) || 0));
      localStorage.setItem(bestKey, String(best));
      bestEl.textContent = `${best} PTS`;
    } catch { /* storage may be unavailable */ }
  }

  function update(dt: number) {
    if (car$.ended) { renderer.render(scene, camera); return; }
    const hand = ctx.hand;
    const hands = hand?.hands?.filter((h) => h.confidence > 0.35) ?? [];
    const handActive = !!hand?.present;
    const keyLeft = ctx.keys.down('ArrowLeft') || ctx.keys.down('KeyA');
    const keyRight = ctx.keys.down('ArrowRight') || ctx.keys.down('KeyD');
    const keyGas = ctx.keys.down('ArrowUp') || ctx.keys.down('KeyW');
    const keyBrake = ctx.keys.down('ArrowDown') || ctx.keys.down('KeyS') || ctx.keys.down('Space');
    let gas = keyGas || gasPointer;
    let brake = keyBrake || brakePointer;
    let desiredSteer = Number(keyRight) - Number(keyLeft);
    if (handActive && hand) {
      const offset = averageHandX() - handNeutral;
      desiredSteer = Math.abs(offset) < 0.035 ? 0 : Math.max(-1, Math.min(1, offset * 3.5));
      const gestures = hands.length ? hands.map((h) => h.gesture) : [hand.gesture];
      if (gestures.includes('open')) gas = true;
      if (gestures.includes('fist')) { brake = true; if (gestures.includes('open')) gas = false; }
      handSeen = car$.elapsed;
    }
    const lost = !!ctx.hand && !handActive && car$.elapsed - handSeen > 0.22;
    if (lost) { gas = keyGas || gasPointer; active.textContent = gas ? 'PEDAL FALLBACK' : 'THROTTLE RELEASED'; }

    const events = stepDrive(car$, dt, { steer: desiredSteer, gas, brake });

    wheelAngle += (car$.steer * 38 - wheelAngle) * Math.min(1, dt * 6);
    wheelEl.style.transform = `rotate(${wheelAngle}deg)`;
    $('[data-steer-value]').textContent = `CAMERA STEERING · ${car$.steer < -0.12 ? 'LEFT' : car$.steer > 0.12 ? 'RIGHT' : 'CENTER'}`;
    car.position.x += (car$.carX - car.position.x) * Math.min(1, dt * 5);
    car.rotation.z = -car$.steer * 0.075;
    const speedFactor = 0.27 + car$.speed / 180;
    const worldStep = speedFactor * dt * 17;
    const bend = cornering(car$.distance);
    for (const d of dashes) { d.position.z += worldStep; if (d.position.z > 12) d.position.z -= 216; d.position.x = (d.position.x < 0 ? -2.55 : 2.55) + trackOffset(d.position.z); }
    for (const p of posts) { p.position.z += worldStep; if (p.position.z > 18) p.position.z -= 234; p.position.x = (p.position.x < 0 ? -9.5 : 9.5) + trackOffset(p.position.z); }
    for (const o of obstacles) {
      o.z += worldStep;
      o.root.position.z = o.z;
      o.root.position.x = o.x + trackOffset(o.z);
      if (!o.hit && o.z > -1.2 && o.z < 2.3) {
        o.hit = true;
        if (passObstacle(car$, o.x)?.type === 'impact') {
          collisionFlash = 0.65;
          ctx.sound.beep(130, 0.16);
          message.textContent = 'IMPACT · CHECK YOUR LINE';
        }
      }
      if (o.z > 18) {
        o.z = -190 - Math.random() * 75;
        o.x = lanes[Math.floor(Math.random() * lanes.length)];
        o.hit = false; o.root.position.x = o.x;
      }
    }
    collisionFlash = Math.max(0, collisionFlash - dt);

    const score = scoreOf(car$);
    const lap = lapOf(car$);
    const playerProgress = Math.min(1, car$.distance / TRACK_LENGTH), rivalProgress = Math.min(1, car$.rivalDistance / TRACK_LENGTH);
    const inFront = car$.distance >= car$.rivalDistance;
    ctx.setScore(score); ctx.setInfo(`LAP ${lap}/3 · ${inFront ? 'P1' : 'P2'}`);
    $('[data-distance]').textContent = `${(car$.distance / 1000).toFixed(2)} KM`;
    $('[data-playerbar]').setAttribute('style', `transform:scaleX(${playerProgress})`);
    $('[data-rivalbar]').setAttribute('style', `transform:scaleX(${rivalProgress})`);
    $('[data-race-state]').textContent = inFront ? 'YOU ARE LEADING' : 'RIVAL AHEAD';
    $('[data-lap]').textContent = `LAP ${lap} / 3`;
    const timeSeconds = Math.floor(car$.elapsed);
    $('[data-race-time]').textContent = `${String(Math.floor(timeSeconds / 60)).padStart(2, '0')}:${String(timeSeconds % 60).padStart(2, '0')}`;
    $('[data-speed]').textContent = String(Math.round(car$.speed)).padStart(3, '0');
    $('[data-speedbar]').setAttribute('style', `transform:scaleX(${Math.min(1, car$.speed / 260)})`);
    $('[data-condition]').textContent = `${Math.round(car$.condition)}%`;
    $('[data-conditionbar]').setAttribute('style', `transform:scaleX(${car$.condition / 100})`);
    tracking.textContent = !ctx.hand ? 'CAMERA · OFF' : handActive ? `TRACKING · ${hands.length || 1} HAND${hands.length === 1 ? '' : 'S'}` : 'TRACKING · LOST';
    tracking.parentElement?.classList.toggle('is-lost', lost);
    const gestureGas = handActive && hands.some((h) => h.gesture === 'open');
    const gestureBrake = handActive && hands.some((h) => h.gesture === 'fist');
    active.textContent = lost ? (gas ? 'PEDAL FALLBACK' : 'THROTTLE RELEASED') : gestureBrake ? 'HAND BRAKE' : gestureGas ? 'HAND THROTTLE' : gasPointer || keyGas ? 'ACCELERATOR' : brakePointer || keyBrake ? 'BRAKE' : 'READY';
    if (collisionFlash <= 0 && car$.speed > 188 && bend > 0.026) message.textContent = 'CORNER AHEAD · BRAKE TO PROTECT THE CAR';
    else if (collisionFlash <= 0 && handActive) message.textContent = Math.abs(car$.steer) > 0.15
      ? `CAMERA STEERING ${car$.steer < 0 ? 'LEFT' : 'RIGHT'} · ${gestureBrake ? 'BRAKING' : gestureGas ? 'ACCELERATING' : 'USE PEDALS TO DRIVE'}`
      : 'BEAT THE RIVAL · BRAKE FOR CORNERS · DODGE TRAFFIC';
    else if (collisionFlash <= 0 && lost) message.textContent = 'HAND LOST · THROTTLE RELEASED · RECONNECT OR USE PEDALS';
    else if (collisionFlash <= 0 && !handActive && car$.speed === 0) message.textContent = 'READY · HOLD THE PEDAL TO ACCELERATE';

    for (const event of events) {
      if (event.type === 'wrecked' || event.type === 'finish' || event.type === 'outrun') {
        recordScore(score);
        ctx.gameOver(score, event.note);
      }
    }
    updateTrack();
    rival.position.set(2.6 + trackOffset(-Math.max(-170, Math.min(18, (car$.rivalDistance - car$.distance) / ROAD_SCALE))), 0.28, -Math.max(-170, Math.min(18, (car$.rivalDistance - car$.distance) / ROAD_SCALE)));
    camera.position.x += (car.position.x * 0.28 - camera.position.x) * Math.min(1, dt * 2);
    renderer.render(scene, camera);
  }

  return {
    update,
    destroy() {
      observer.disconnect(); window.removeEventListener('blur', onBlur);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
        else if (mesh.material) mesh.material.dispose();
      });
      renderer.dispose(); renderer.domElement.remove(); host.remove();
    },
  };
}
