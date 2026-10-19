import type { GameModule } from '../play/types';

// One lazy chunk per game. Keys are the slugs in games.ts; folder names can differ.
export const GAME_LOADERS: Record<string, () => Promise<GameModule>> = {
  'apex-drive': () => import('./apex-drive'),
  'rail-rush': () => import('./rail-rush'),
  'hill-climb': () => import('./hill-climb'),
  rps: () => import('./rps'),
  'scream-chicken': () => import('./scream-chicken'),
  'quiz-battle': () => import('./quiz-battle'),
};
