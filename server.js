// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { log } = require('console');
const app = require('./src/app');
const gameHandler = require('./src/socket/gameHandler');
const gameUtils = require('./src/utils/gameUtils');

app.use(cors());


// Endpoints simples
// app.get('/', (req, res) => res.send('OK'));
// app.get('/health', (req, res) => res.send('OK'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // restreins à http://localhost:8100 si besoin
    methods: ['GET', 'POST'],
  },
});


io.on('connection', (socket) => {
  console.log('client connected:', socket.id);

  gameHandler(io, socket);

});

const PORT = 3001;
server.on('error', (err) => console.error('HTTP server error:', err));
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.IO server running on http://localhost:${PORT}`);
});
