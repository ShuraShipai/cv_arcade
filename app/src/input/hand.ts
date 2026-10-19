// Hand tracking with MediaPipe HandLandmarker. Loaded only on game pages that need a camera.
// The model runs on its own loop (once per camera frame, about 30fps) and writes into `state`;
// games read `state` from their 60fps loop.
import type { HandLandmarker } from '@mediapipe/tasks-vision';

const MP_VERSION = '0.10.18'; // keep in step with package.json
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export type Gesture = 'open' | 'fist' | 'peace' | 'point' | 'none';

export interface HandState {
  /** A hand is in the frame right now. */
  present: boolean;
  /** Palm centre, 0..1, mirrored so moving your hand right moves x right. */
  x: number;
  y: number;
  gesture: Gesture;
  /** 0..1: model score times how steady the gesture has been over the last frames. */
  confidence: number;
  /** Counts quick upward hand movements. Games compare it with the last value they saw. */
  jumpEvent: number;
  /** Radians, 0 = fingers straight up, positive = leaning right (mirrored). */
  tilt: number;
  /** The 21 landmarks, mirrored, for the preview and ?debug=1. */
  landmarks: { x: number; y: number }[];
  /** Model frames per second, for ?debug=1. */
  fps: number;
  /** All tracked hands; primary-hand fields above remain available to existing games. */
  hands: { x: number; y: number; gesture: Gesture; confidence: number; landmarks: { x: number; y: number }[] }[];
}

export interface HandTracker {
  state: HandState;
  stop(): void;
}

type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

export function classify(lm: P[]): Gesture {
  const w = lm[0];
  // A finger is extended when its tip is clearly farther from the wrist than its middle joint.
  const ext = (tip: number, pip: number) => dist(lm[tip], w) > dist(lm[pip], w) * 1.12;
  const index = ext(8, 6), middle = ext(12, 10), ring = ext(16, 14), pinky = ext(20, 18);
  const count = [index, middle, ring, pinky].filter(Boolean).length;
  if (count >= 4) return 'open';
  if (count === 0) return 'fist';
  if (index && middle && !ring && !pinky) return 'peace';
  if (index && !middle && !ring && !pinky) return 'point';
  return count === 3 ? 'open' : 'none';
}

async function createLandmarker(numHands: number): Promise<HandLandmarker> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const make = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands,
    });
  try {
    return await make('GPU');
  } catch {
    return await make('CPU');
  }
}

/** Starts tracking on a playing <video>. Throws a plain-words Error if the model can't load. */
export async function startHandTracker(video: HTMLVideoElement, numHands = 1): Promise<HandTracker> {
  let landmarker: HandLandmarker;
  try {
    landmarker = await createLandmarker(numHands);
  } catch {
    throw new Error('The hand model did not load. Check your internet connection, then press Start again.');
  }

  const state: HandState = {
    present: false, x: 0.5, y: 0.5, gesture: 'none', confidence: 0,
    jumpEvent: 0, tilt: 0, landmarks: [], fps: 0, hands: [],
  };
  const recent: Gesture[] = [];
  const trail: { y: number; t: number }[] = [];
  let lastJump = 0, lastVideoTime = -1, stopped = false, frames = 0, fpsStart = performance.now();
  let timer = 0;

  const step = () => {
    if (stopped) return;
    const now = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = landmarker.detectForVideo(video, now);
      frames++;
      const raw = res.landmarks[0];
      state.hands = res.landmarks.map((points, index) => {
        const lm = points.map((p) => ({ x: 1 - p.x, y: p.y }));
        const palm = [0, 5, 9, 13, 17].map((i) => lm[i]);
        return {
          x: palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
          y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
          gesture: classify(lm), confidence: res.handedness[index]?.[0]?.score ?? 0.8, landmarks: lm,
        };
      });
      if (raw) {
        const lm = raw.map((p) => ({ x: 1 - p.x, y: p.y }));
        const palm = [0, 5, 9, 13, 17].map((i) => lm[i]);
        const px = palm.reduce((s, p) => s + p.x, 0) / 5;
        const py = palm.reduce((s, p) => s + p.y, 0) / 5;
        state.x = state.present ? state.x + (px - state.x) * 0.6 : px;
        state.y = state.present ? state.y + (py - state.y) * 0.6 : py;
        state.present = true;
        state.landmarks = lm;
        state.tilt = Math.atan2(lm[9].x - lm[0].x, lm[0].y - lm[9].y);
        const g = classify(lm);
        recent.push(g);
        if (recent.length > 6) recent.shift();
        const steady = recent.filter((r) => r === g).length / recent.length;
        state.gesture = g;
        state.confidence = (res.handedness[0]?.[0]?.score ?? 0.8) * steady;
        // Jump: the palm rises by more than 12% of the frame height within 180ms.
        trail.push({ y: py, t: now });
        while (trail.length && now - trail[0].t > 180) trail.shift();
        if (trail.length > 1 && trail[0].y - py > 0.12 && now - lastJump > 450) {
          state.jumpEvent++;
          lastJump = now;
          trail.length = 0;
        }
      } else {
        state.present = false;
        state.gesture = 'none';
        state.confidence = 0;
        state.landmarks = [];
        state.hands = [];
        recent.length = 0;
        trail.length = 0;
      }
    }
    if (now - fpsStart >= 1000) {
      state.fps = Math.round((frames * 1000) / (now - fpsStart));
      frames = 0;
      fpsStart = now;
    }
    schedule();
  };
  const schedule = () => {
    if (stopped) return;
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step);
    else timer = window.setTimeout(step, 16);
  };
  schedule();

  return {
    state,
    stop() {
      stopped = true;
      clearTimeout(timer);
      landmarker.close();
    },
  };
}
