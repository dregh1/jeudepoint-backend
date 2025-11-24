// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// code -> {
//   turn: 0|1,
//   players: Map<socketId, { index: 0|1 }>,
//   owner: Map<'row,col', 0|1> // occupation des cases jouées
// }
const rooms = new Map();

const app = express();
app.use(cors());

// Endpoints simples
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // restreins à http://localhost:8100 si besoin
    methods: ['GET', 'POST'],
  },
});

// Helpers
function normalizeCode(v) {
  return String(v ?? '').trim();
}
function ensureRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { turn: 0, players: new Map(), owner: new Map() });
  }
  return rooms.get(code);
}
function getFreeIndex(r) {
  const used = new Set([...r.players.values()].map((p) => p.index));
  return used.has(0) ? 1 : 0;
}

io.on('connection', (socket) => {
  console.log('client connected:', socket.id);

  // Log global utile pour comprendre la séquence
  socket.onAny((event, payload) => {
    console.log(`[onAny] ${event} from ${socket.id}`, payload);
  });

  function joinRoomInternal(codeRaw, asCreate = false) {
    const code = normalizeCode(codeRaw);
    if (!code) return;

    const r = ensureRoom(code);

    // Déjà membre ? éviter les doubles create/join
    if (r.players.has(socket.id)) {
      console.log(`[room:${asCreate ? 'create' : 'join'}] déjà membre`, code, socket.id);
      socket.emit('room:status', { code, players: r.players.size });
      if (r.players.size === 2) io.to(code).emit('room:ready', { code, turn: r.turn });
      return;
    }

    if (r.players.size >= 2) {
      socket.emit('room:error', { message: 'Room complète' });
      return;
    }

    const myIndex = getFreeIndex(r);
    socket.join(code);
    r.players.set(socket.id, { index: myIndex });

    console.log(`[room:${asCreate ? 'create' : 'join'}]`, code, '=> index', myIndex, 'size', r.players.size);
    io.to(code).emit('room:status', { code, players: r.players.size });

    if (r.players.size === 2) {
      io.to(code).emit('room:ready', { code, turn: r.turn });
    }
  }

  socket.on('room:create', ({ code } = {}) => {
    joinRoomInternal(code, true);
  });

  socket.on('room:join', ({ code } = {}) => {
    const c = normalizeCode(code);
    if (!rooms.has(c)) {
      socket.emit('room:error', { message: 'Room introuvable' });
      return;
    }
    joinRoomInternal(c, false);
  });

  socket.on('room:state', ({ code } = {}) => {
    const c = normalizeCode(code);
    const r = rooms.get(c);
    if (!r) {
      socket.emit('room:error', { message: 'Room introuvable' });
      return;
    }
    socket.emit('room:state', { code: c, turn: r.turn, players: r.players.size });
  });

  // Serveur arbitre: valide, applique, diffuse
  socket.on('play:move', ({ code, col, row } = {}) => {
    const c = normalizeCode(code);
    console.log('[server] play:move received', { from: socket.id, code: c, col, row });
  
    const r = rooms.get(c);
    if (!r) {
      socket.emit('play:error', { message: 'Room inconnue', code: c });
      return;
    }
  
    if (!Number.isFinite(col) || !Number.isFinite(row)) return;
  
    const player = r.players.get(socket.id);
    if (!player) {
      socket.emit('play:error', { message: 'Tu ne fais pas partie de cette room' });
      return;
    }
  
    if (player.index !== r.turn) {
      socket.emit('play:error', { message: 'Pas ton tour' });
      return;
    }
  
    const key = `${row},${col}`;
    if (r.owner.has(key)) {
      socket.emit('play:error', { message: 'Case déjà prise' });
      return;
    }
    r.owner.set(key, player.index);
  
    const nextTurn = (r.turn + 1) % 2;
    r.turn = nextTurn;
  
    console.log('[server] broadcast play:move', { code: c, col, row, playerIndex: player.index, nextTurn });
    io.to(c).emit('play:move', { code: c, col, row, playerIndex: player.index, nextTurn });
  });
  

  socket.on('room:leave', ({ code } = {}) => {
    const c = normalizeCode(code);
    const r = rooms.get(c);
    socket.leave(c);
    if (!r) return;

    if (r.players.delete(socket.id)) {
      io.to(c).emit('room:status', { code: c, players: r.players.size });
      if (r.players.size === 0) {
        rooms.delete(c);
      } else {
        r.turn = 0;
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('client disconnected:', socket.id);
    for (const [code, r] of rooms.entries()) {
      if (r.players.has(socket.id)) {
        r.players.delete(socket.id);
        io.to(code).emit('room:status', { code, players: r.players.size });
        if (r.players.size === 0) {
          rooms.delete(code);
        } else {
          r.turn = 0;
        }
      }
    }
  });
});

const PORT = 3001;
server.on('error', (err) => console.error('HTTP server error:', err));
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.IO server running on http://localhost:${PORT}`);
});
