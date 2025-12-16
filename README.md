# Collaboard — Upgraded UI/UX (MVP+)

This upgraded project adds:
- Structured homepage with Create / Join cards
- Mouse cursor tracking (different color per user)
- Improved whiteboard UI: toolbar, shapes (rect/circle/line), text tool, stroke patterns (solid/dashed/dotted), eraser
- In-memory storage of strokes and shapes so late joiners catch up
- Simple, clean UI/UX improvements (cards, toolbar, participants list)

## Structure
- `/server` — Node.js + Express + Socket.IO backend
- `/client` — React + Vite frontend

## Run locally

1. Start the server:
```bash
cd server
npm install
npm start
```

2. Start the client (in another terminal):
```bash
cd client
npm install
npm run dev
```

3. Open the Vite URL (usually http://localhost:5173)

## Notes
- Rooms and data are stored in memory; server restart clears rooms.
- Cursor updates are throttled to reduce bandwidth.
- This MVP focuses on UI/UX improvements; further polishing and persistence can be added next.

