# OpenArcade

An arcade played with hand gestures, your voice, or an AI quiz that reads your notes.
Our team project from the training: computer vision, RAG, chatbots and LLMs.

| Game | Input | Needs |
| --- | --- | --- |
| Rail Rush | Hand: position picks the lane, quick raise jumps, fist rolls | Camera |
| Hill Climb | Hand: open palm gas, fist brake, tilt to lean | Camera |
| Rock Paper Scissors | Hand: fist, palm, two fingers | Camera |
| Scream Chicken | Voice loudness: talk to walk, shout to jump | Microphone |
| AI Quiz Battle | Questions written from a deck or your notes (RAG) | Nothing |

Every game also plays with the keyboard, so you can develop without a camera or mic.

## Run the web app

Needs Node 18 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

- `npm run build` type-checks and builds to `dist/`. `npm run preview` serves that build.
- `npm test` runs the head-less checks for the cabinet wiring and the Apex Drive and Claw Machine rules.
- Camera and mic only work on `localhost` or `https`.
- Add `?debug=1` to a game URL (for example `/play/rps?debug=1`) to see landmarks and raw hand / mic numbers.
- `/play/<slug>` routes need a server that falls back to `index.html` (Vite dev and preview already do).

The older standalone prototypes are still here and unchanged: `index.html` + `game.js` at the
root (ScreamLeap, open the file directly) and `subway_runner/` (Python, see its folder).

## Mock mode and the backend

The app ships with mocks so it is fully playable with no backend. Pip's answers and quiz
questions come from `app/src/mocks/` while `VITE_USE_MOCK` is on, which is the default.

To use the real RAG backend:

1. Copy `.env.example` to `.env`.
2. Set `VITE_USE_MOCK=false`.
3. Point the app at the backend, either way:
   - `VITE_API_BASE=http://localhost:8000`. The backend must allow CORS from the app's origin.
   - Or leave `VITE_API_BASE` empty and set `API_PROXY=http://localhost:8000`. The Vite dev server then forwards `/api/*`, so no CORS is needed. This works in development only.
4. Restart `npm run dev`. Vite reads `.env` at start-up.

### API contract

`POST /api/chat`

```json
{ "message": "How do I play Hill Climb?", "history": [{ "role": "user", "content": "..." }], "gameSlug": "hill-climb" }
```

Reply as Server-Sent Events (`Content-Type: text/event-stream`), one JSON object per `data:` line:

```
data: {"type":"token","text":"Show an open "}
data: {"type":"sources","sources":[{"id":"hill-climb#controls","title":"Hill Climb","game":"hill-climb","section":"Controls","snippet":"Open palm: gas"}]}
data: {"type":"done"}
```

A plain JSON reply `{ "answer": "...", "sources": [...] }` also works. `history` holds the last
6 turns. `gameSlug` is set when Pip is opened on a game page. Return `sources: []` when nothing
was retrieved; Pip then shows "no source found".

`POST /api/quiz/question`

```json
{ "deck": "rag", "difficulty": "normal", "askedIds": ["rag-1"] }
```

`deck` is one of `cv`, `rag`, `chatbots`, `llms`, or `{ "text": "..." }` with the player's pasted
notes. PDF text has `[page N]` markers so you can cite pages. Reply:

```json
{ "id": "rag-2", "question": "...", "options": ["A", "B", "C", "D"], "answerIndex": 1,
  "explanation": "...", "source": { "title": "notes_week3.pdf", "page": 4 } }
```

### Knowledge files for RAG ingestion

`npm run export-kb` writes `knowledge/<slug>.md` (rules, controls, scoring, tips,
troubleshooting) from `app/src/games.ts`. Ingest that folder, so Pip and the game screens use
the same text. Re-run it whenever `games.ts` changes.

## Where things live

See [AGENTS.md](AGENTS.md) for the folder layout, conventions and how to add a game.
