const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 4000;

// Utility: random pleasant color
function randomColor() {
  const colors = ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899'];
  return colors[Math.floor(Math.random()*colors.length)];
}

// rooms: Map roomId -> { users: {socketId: {name,color}}, strokes: [], shapes: [] }
const rooms = new Map();

app.get('/create-room', (req, res) => {
  const roomId = nanoid(8);
  rooms.set(roomId, { strokes: [], shapes: [], users: {} });
  res.json({ roomId });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join-room', ({ roomId, name }) => {
    if (!roomId || !name) {
      socket.emit('error-message', 'roomId and name are required to join');
      return;
    }
    if (!rooms.has(roomId)) {
      socket.emit('room-not-found', { roomId });
      return;
    }
    socket.join(roomId);
    const room = rooms.get(roomId);
    const color = randomColor();
    room.users[socket.id] = { name, color };

    // send current board state (strokes + shapes) and assigned color + participants
    const participants = Object.entries(room.users).map(([id, info]) => ({ id, name: info.name, color: info.color }));
    socket.emit('initial-state', { strokes: room.strokes || [], shapes: room.shapes || [], assignedColor: color, participants });

    // broadcast participants list
    io.in(roomId).emit('participants', participants);
    socket.to(roomId).emit('user-joined', { id: socket.id, name, color });
  });

  socket.on('draw-stroke', ({ roomId, stroke }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.strokes.push(stroke);
    socket.to(roomId).emit('remote-stroke', stroke);
  });

  socket.on('create-shape', ({ roomId, shape }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.shapes.push(shape);
    socket.to(roomId).emit('shape-created', shape);
  });

  socket.on('clear-board', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.strokes = [];
    room.shapes = [];
    io.in(roomId).emit('clear-board');
  });

  socket.on('cursor-move', ({ roomId, x, y }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = room.users[socket.id];
    if (!user) return;
    // broadcast to others
    socket.to(roomId).emit('remote-cursor', { id: socket.id, name: user.name, color: user.color, x, y });
  });

  socket.on('disconnect', () => {
    // remove user from rooms
    for (const roomId of rooms.keys()) {
      const room = rooms.get(roomId);
      if (room && room.users && room.users[socket.id]) {
        const info = room.users[socket.id];
        delete room.users[socket.id];
        const participants = Object.entries(room.users).map(([id, info]) => ({ id, name: info.name, color: info.color }));
        io.in(roomId).emit('participants', participants);
        io.in(roomId).emit('user-left', { id: socket.id, name: info.name });
      }
    }
    console.log('socket disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
