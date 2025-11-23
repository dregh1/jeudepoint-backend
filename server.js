const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// code -> { turn: 0|1, players: Map<socketId, number> }
const rooms = new Map();

const app = express();
app.use(cors());

// Endpoints simples de test
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // En dev, autoriser large. Tu peux restreindre à 'http://localhost:8100'
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Helpers
function ensureRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { turn: 0, players: new Map() });
  }
  return rooms.get(code);
}

function getPlayerIndexForSocket(code, socketId) {
  const r = rooms.get(code);
  if (!r) return undefined;
  return r.players.get(socketId);
}

io.on('connection', (socket) => {
  console.log('client connected:', socket.id);

  // Création/join factorisé
  const joinRoomInternal = (code, asCreate = false) => {
    const r = ensureRoom(code);

    if (r.players.size >= 2) {
      socket.emit('room:error', { message: 'Room complète' });
      return false;
    }

    // Assigner un index: 0 s'il n'y a personne, sinon 1
    const myIndex = r.players.size === 0 ? 0 : 1;

    socket.join(code);
    r.players.set(socket.id, myIndex);

    console.log(`[room:${asCreate ? 'create' : 'join'}]`, code, '=> index', myIndex);

    io.to(code).emit('room:status', { code, players: r.players.size });

    // Quand on a 2 joueurs, notifier "ready" + tour courant
    if (r.players.size === 2) {
      io.to(code).emit('room:ready', { code, turn: r.turn }); // 0 = host, 1 = guest
    }
    return true;
  };

  // Créer une room et y entrer
  socket.on('room:create', ({ code }) => {
    if (!code) return;
    joinRoomInternal(code, true);
  });

  // Rejoindre une room existante
  socket.on('room:join', ({ code }) => {
    if (!code) return;
    if (!rooms.has(code)) {
      socket.emit('room:error', { message: 'Room introuvable' });
      return;
    }
    joinRoomInternal(code, false);
  });

  // Demander l'état courant (tour, nb joueurs)
  socket.on('room:state', ({ code }) => {
    const r = rooms.get(code);
    if (!r) {
      socket.emit('room:error', { message: 'Room introuvable' });
      return;
    }
    socket.emit('room:state', { code, turn: r.turn, players: r.players.size });
  });

  // Coup joué: on ne fait PAS confiance au playerIndex du client,
  // on le déduit via socket.id
  socket.on('play:move', ({ code, col, row /*, playerIndex (ignoré) */ }) => {
    const r = rooms.get(code);
    if (!r) return;
    if (typeof col !== 'number' || typeof row !== 'number') return;

    const senderIndex = r.players.get(socket.id);
    if (senderIndex === undefined) {
      socket.emit('play:error', { message: 'Tu ne fais pas partie de cette room' });
      return;
    }
    if (senderIndex !== r.turn) {
      socket.emit('play:error', { message: 'Pas ton tour' });
      return;
    }

    const nextTurn = (r.turn + 1) % 2;
    r.turn = nextTurn;

    console.log('[play:move]', code, { col, row, playerIndex: senderIndex }, '-> next', nextTurn);

    // Diffuser à toute la room (y compris l'émetteur)
    io.to(code).emit('play:move', {
      code,
      col,
      row,
      playerIndex: senderIndex,
      nextTurn,
    });
  });

  // Quitter la room explicitement
  socket.on('room:leave', ({ code }) => {
    const r = rooms.get(code);
    socket.leave(code);
    if (r) {
      r.players.delete(socket.id);
      io.to(code).emit('room:status', { code, players: r.players.size });
      if (r.players.size === 0) {
        rooms.delete(code);
      } else {
        // Simple reset pour éviter un "tour fantôme"
        r.turn = 0;
      }
    }
  });

  // Déconnexion: nettoyer toutes les rooms où le socket était
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

// Démarrage du serveur
const PORT = 3001;
server.on('error', (err) => {
  console.error('HTTP server error:', err);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.IO server running on http://localhost:${PORT}`);
});
