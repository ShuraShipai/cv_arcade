// Single source of truth for every game: the cabinet list, the Ready screen, Pip's mock
// answers and the RAG knowledge files (npm run export-kb) all read from here.

export type InputType = 'hand' | 'voice' | 'rag';
export type Need = 'camera' | 'mic' | 'none';

export interface Game {
  slug: string;
  title: string;
  input: InputType;
  players: string;
  color: string;
  shortDescription: string;
  rules: string[];
  controls: string[];
  scoring: string;
  tips: string[];
  needs: Need;
  needsText?: string;
  /** Voice-command games can skip level calibration and the loudness meter. */
  calibrateMic?: boolean;
  showMicMeter?: boolean;
  troubleshooting: string[];
}

// Color means input type everywhere: cyan = hand, pink = voice, yellow = RAG/notes.
export const INPUT_META: Record<InputType, { tag: string; kind: string; label: string; color: string }> = {
  hand: { tag: 'HAND', kind: 'HANDS', label: 'Hand gestures', color: '#19f0ff' },
  voice: { tag: 'VOICE', kind: 'VOICE', label: 'Voice', color: '#ff2bd6' },
  rag: { tag: 'RAG', kind: 'YOUR NOTES', label: 'Your notes', color: '#ffe14a' },
};

const CAMERA_HELP = [
  'Camera blocked: click the camera icon in the address bar, allow it, then press Start again.',
  'No hand found: step back so your whole hand fits in the preview, and face a light rather than a window.',
  'Another app may be using the camera. Close video calls, then reload the page.',
  'No camera at all? Choose "Play with keyboard instead" on the Ready screen.',
];

const MIC_HELP = [
  'Mic blocked: click the microphone icon in the address bar, allow it, then press Start again.',
  'Stay quiet during the 2-second calibration so the game learns how loud the room is.',
  'If the game reacts to background noise, lower the sensitivity slider on the Ready screen.',
  'No microphone? Choose "Play with keyboard instead" on the Ready screen.',
];

// List order on the cabinet: hand games first, then voice, then RAG.
export const GAMES: Game[] = [
  {
    slug: 'apex-drive',
    title: 'Apex Drive',
    input: 'hand',
    players: '1 player',
    color: INPUT_META.hand.color,
    shortDescription: 'Beat a rival over three laps. Steer the bends and brake on time.',
    rules: [
      'Move both hands left or right in the camera preview to steer. Press Calibrate Hands with your hands centered first.',
      'Open palms accelerate and fists brake. You can also hold the on-screen pedals.',
      'Beat the rival over three laps. Collisions and taking corners too fast damage your car; three impacts or enough corner damage wrecks it.',
    ],
    controls: [
      'Keyboard: left/right arrows or A/D steer; up/W accelerates; down/S or space brakes.',
      'On-screen accelerator and brake: press and hold.',
      'Camera steering: center both hands and press Calibrate Hands, then move both hands left/right. Open palms accelerate; fists brake.',
    ],
    scoring: 'Finish the race for distance points. Close passes add a bonus.',
    tips: [
      'Use short steering movements to stay centered in a lane.',
      'Ease off the accelerator before traffic and use the brake to regain control.',
      'If hand tracking is lost, throttle releases automatically. Use the on-screen pedals or keyboard.',
    ],
    needs: 'camera',
    troubleshooting: CAMERA_HELP,
  },
  {
    slug: 'rail-rush',
    title: 'Rail Rush',
    input: 'hand',
    players: '1 player',
    color: INPUT_META.hand.color,
    shortDescription: 'Move your hand to switch lanes. Dodge trains, grab coins.',
    rules: [
      'Move your hand to the left, middle or right of the camera to switch lanes.',
      'Raise your hand quickly to jump barriers. Close your fist to roll under bars.',
      'One hit ends the run, and the track speeds up the longer you last.',
    ],
    controls: [
      'Hand in the left, middle or right third of the camera: change lane',
      'Quick upward hand movement: jump',
      'Closed fist: roll',
      'Keyboard: left and right arrows change lane, up arrow or space jumps, down arrow rolls',
    ],
    scoring: 'You score 1 point per metre you run and 10 points per coin.',
    tips: [
      'Keep your hand at chest height so a quick raise reads as a jump.',
      'Trains fill a whole lane. Switch lanes early instead of jumping.',
      'Coins often sit in the safe lane, so follow the coins.',
    ],
    needs: 'camera',
    troubleshooting: CAMERA_HELP,
  },
  {
    slug: 'hill-climb',
    title: 'Hill Climb',
    input: 'hand',
    players: '1 player',
    color: INPUT_META.hand.color,
    shortDescription: 'Open palm for gas, fist to brake. Tilt your hand to lean.',
    rules: [
      'Show an open palm to drive forward. Close your fist to brake or reverse.',
      'Tilt your hand to lean the car while it is in the air.',
      'Grab fuel cans before the tank runs dry. Landing on your roof ends the run.',
    ],
    controls: [
      'Open palm: gas',
      'Closed fist: brake, then reverse',
      'Tilt your hand left or right: lean back or forward in the air',
      'Keyboard: right arrow is gas, left arrow brakes, up and down arrows lean',
    ],
    scoring: 'You score 1 point per metre, 10 per coin, and a bonus for every second in the air.',
    tips: [
      'Ease off the gas just before a hilltop so you do not flip.',
      'Lean forward in the air to land on all four wheels.',
      'Fuel lasts about 30 seconds, so do not skip a fuel can.',
    ],
    needs: 'camera',
    troubleshooting: CAMERA_HELP,
  },
  {
    slug: 'rps',
    title: 'Rock Paper Scissors',
    input: 'hand',
    players: '1 player vs computer',
    color: INPUT_META.hand.color,
    shortDescription: 'Best of five against the computer. Show your move on shoot.',
    rules: [
      'Wait for the 3-2-1 countdown, then hold your move when the screen says shoot.',
      'A fist is rock, an open palm is paper, and your index and middle finger are scissors.',
      'The first to win 3 rounds takes the match. Draws do not count.',
    ],
    controls: [
      'Closed fist: rock',
      'Open palm: paper',
      'Index and middle finger up: scissors',
      'Keyboard: 1 is rock, 2 is paper, 3 is scissors. The on-screen buttons work too.',
    ],
    scoring: 'Each round you win scores 100 points. Winning the match adds 200.',
    tips: [
      'Hold your move still for a moment before shoot. The confidence bar shows what the camera sees.',
      'Keep your palm facing the camera so all fingers are visible.',
      'If the camera fails, use the rock, paper and scissors buttons.',
    ],
    needs: 'camera',
    troubleshooting: CAMERA_HELP,
  },
  {
    slug: 'scream-chicken',
    title: 'Scream Chicken',
    input: 'voice',
    players: '1 player',
    color: INPUT_META.voice.color,
    shortDescription: 'Your voice moves the chicken. Shout to jump the gaps.',
    rules: [
      'Stay quiet to stand still, talk to walk, and shout to jump.',
      'The louder you shout, the higher the chicken jumps.',
      'Falling into a gap ends the run. Walls stop you until you jump over them.',
    ],
    controls: [
      'Quiet: stand still',
      'Talking voice: walk',
      'Shout: jump. Louder means higher.',
      'Keyboard: right arrow walks, space jumps. Hold space longer for a higher jump.',
    ],
    scoring: 'You score 1 point per metre and 25 points per golden egg.',
    tips: [
      'Stay silent during the 2-second calibration at the start.',
      'Wide gaps need a long, loud shout. Short walls need only a yelp.',
      'Move the sensitivity slider up if you are in a quiet room.',
    ],
    needs: 'mic',
    troubleshooting: MIC_HELP,
  },
  {
    slug: 'claw-machine',
    title: 'Claw Machine',
    input: 'voice',
    players: '1 player',
    color: INPUT_META.voice.color,
    shortDescription: 'A mall prize crane. Say left, right, up, down and go to grab a plush.',
    rules: [
      'Say left, right, up or down to drive the claw over the prize pit. Up moves to the back of the cabinet, down to the front.',
      'Say go to grab: the claw stops, lowers, closes and lifts. Center it on a prize or it comes up empty.',
      'Every grab costs one credit. Land prizes in the chute before the 90-second timer or your 5 credits run out.',
    ],
    controls: [
      'Voice: say left, right, up or down to move the claw, and go to grab.',
      'Keyboard: W or up arrow moves back, S or down arrow moves front, A/D or left/right arrows move sideways, space or enter grabs.',
      'On-screen pad: hold the arrow keys to move and press GRAB to drop the claw.',
      'The claw ignores movement once a grab starts, and returns to the chute by itself when it holds a prize.',
    ],
    scoring: 'Each prize scores its own value, from 150 for a plush up to 260 for the star.',
    tips: [
      'Line the claw up over the middle of a prize. A grab off to one side slips.',
      'Watch the CLAW readout: it shows LOWERING, CLOSING, LIFTING and CARRYING TO CHUTE.',
      'Say one word at a time and pause. The command model listens in short windows.',
    ],
    needs: 'mic',
    needsText: 'Needs your microphone and internet to load a small pretrained command model. It reacts to left, right, up, down and go; recognition runs on this device.',
    calibrateMic: false,
    showMicMeter: false,
    troubleshooting: [
      'No voice input: tap Start Voice Controls after the model loads. The mic bar should move when you speak.',
      'Command model failed to load: check internet access and press Retry command model. The keys and the on-screen pad still work.',
      'Microphone blocked: click the microphone icon in the address bar, allow it, then press Start again.',
      'No microphone found: plug one in or choose Play with keyboard instead.',
    ],
  },
  {
    slug: 'quiz-battle',
    title: 'AI Quiz Battle',
    input: 'rag',
    players: '1 player vs AI, or 2 players',
    color: INPUT_META.rag.color,
    shortDescription: 'Questions from your notes. Faster right answers hit harder.',
    rules: [
      'Pick a deck, or paste your own notes or upload a PDF.',
      'Each question has 4 options and 15 seconds. Press 1 to 4 or click an answer.',
      'Right answers damage the other side. The faster you answer, the bigger the hit.',
    ],
    controls: [
      'Keys 1 to 4 or a click: choose an answer',
      'Two players: player 1 uses 1 to 4, player 2 uses 7, 8, 9 and 0',
      'Space or Enter: skip to the next question after the answer is shown',
    ],
    scoring: 'Your score is the damage you dealt plus a bonus for the HP you have left.',
    tips: [
      'Every question shows a source chip with the file and page it came from. Read it after a miss.',
      'Shorter, focused notes give sharper questions than a whole textbook.',
      'Decks cover Computer Vision, RAG, Chatbots and LLMs from the training.',
    ],
    needs: 'none',
    troubleshooting: [
      'Questions not loading: check your connection, then press Retry. In mock mode they always load.',
      'PDF upload failed: make sure the PDF has selectable text. Scanned images cannot be read.',
      'Questions feel off-topic: paste a shorter section of your notes.',
    ],
  },
];

export function findGame(slug: string): Game | undefined {
  return GAMES.find((g) => g.slug === slug);
}
