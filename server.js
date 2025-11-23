const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:8100',
    methods: ['GET', 'POST'],
  },
});

function getRoomSize(code) {
  const room = io.sockets.adapter.rooms.get(code);
  return room ? room.size : 0;
}

io.on('connection', (socket) => {
  console.log('client connected', socket.id);

  socket.on('room:create', ({ code }) => {
    const size = getRoomSize(code);
    if (size >= 2) {
      socket.emit('room:error', { message: 'Room déjà complète' });
      return;
    }
    socket.join(code);
    const players = getRoomSize(code);
    io.to(code).emit('room:status', { code, players });
    if (players === 2) {
      io.to(code).emit('room:ready', { code });
    }
  });

  // Relai des coups à l'adversaire uniquement
  socket.on('play:move', ({ code, col, row }) => {
    if (!code || typeof col !== 'number' || typeof row !== 'number') return;
    socket.to(code).emit('play:move', { code, col, row });
  });

  socket.on('room:join', ({ code }) => {
    const size = getRoomSize(code);
    if (size === 0) {
      socket.emit('room:error', { message: 'Room introuvable' });
      return;
    }
    if (size >= 2) {
      socket.emit('room:error', { message: 'Room complète' });
      return;
    }
    socket.join(code);
    const players = getRoomSize(code);
    io.to(code).emit('room:status', { code, players });
    if (players === 2) {
      io.to(code).emit('room:ready', { code });
    }
  });

  socket.on('room:leave', ({ code }) => {
    socket.leave(code);
    const players = getRoomSize(code);
    io.to(code).emit('room:status', { code, players });
  });

  socket.on('disconnect', () => {
    console.log('client disconnected', socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log('Socket.IO server on http://localhost:' + PORT);
});
