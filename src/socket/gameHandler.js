const rooms = new Map();
const gameUtils = require('../utils/gameUtils');
const DEFAULT_CONFIG = { cols: 11, rows: 11 };

module.exports = (io, socket) => {
    function ensureRoom(code) {
        if (!rooms.has(code)) {
          rooms.set(code, { turn: 0, players: new Map(), owner: new Map(), config: undefined });
        }
        return rooms.get(code);
      }
      
      function getFreeIndex(r) {
        const used = new Set([...r.players.values()].map((p) => p.index));
        return used.has(0) ? 1 : 0;
      }

    function handlePlayerDeparture(code) {
        const r = rooms.get(code);
        if (!r) return;

        const wasFull = r.players.size === 2;

        // On supprime le joueur
        if (r.players.delete(socket.id)) {
            console.log(`[room:leave] ${socket.id} left ${code}. Remaining: ${r.players.size}`);

            // CAS 1: Il reste un seul joueur (Abandon)
            if (wasFull && r.players.size === 1) {
                // On informe le joueur restant qu'il a gagné par abandon
                io.to(code).emit('room:abandoned', {
                    code,
                    message: "Your opponent has left the game."
                });
                // Note: On peut garder la room ou la supprimer selon votre logique
                r.owner.clear(); 
                r.turn = 0;
            }

            // CAS 2: Plus aucun joueur
            if (r.players.size === 0) {
                rooms.delete(code);
                console.log(`[room:delete] ${code} is now empty and deleted.`);
            } else {
                io.to(code).emit('room:status', { code, players: r.players.size });
            }
        }
    }

    function joinRoomInternal(codeRaw, asCreate = false, configInput) {
        console.log("~#~", configInput);
        const code = gameUtils.normalizeCode(codeRaw);
        if (!code) return;

        const r = ensureRoom(code);

        if (asCreate && configInput && !r.config) {
            r.config = gameUtils.sanitizeConfig(configInput);
        }
        if (!r.config) r.config = { ...DEFAULT_CONFIG };

        if (r.players.has(socket.id)) {
            console.log(`[room:${asCreate ? 'create' : 'join'}] déjà membre`, code, socket.id);
            socket.emit('room:status', { code, players: r.players.size, config: r.config });
            if (r.players.size === 2) io.to(code).emit('room:ready', { code, turn: r.turn, config: r.config });
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
        io.to(code).emit('room:status', { code, players: r.players.size, config: r.config });

        if (r.players.size === 2) {
            io.to(code).emit('room:ready', { code, turn: r.turn, config: r.config });
        }
    }

    socket.on('room:create', ({ code, config } = {}) => {
        console.log("###", config);
        joinRoomInternal(code, true, config);
    });

    socket.on('room:join', ({ code } = {}) => {
        const c = gameUtils.normalizeCode(code);
        if (!rooms.has(c)) {
            socket.emit('room:error', { message: 'Room introuvable' });
            return;
        }
        joinRoomInternal(c, false);
    });

    socket.on('room:state', ({ code } = {}) => {
        const c = gameUtils.normalizeCode(code);
        const r = rooms.get(c);
        if (!r) {
            socket.emit('room:error', { message: 'Room introuvable' });
            return;
        }
        socket.emit('room:state', { code: c, turn: r.turn, players: r.players.size, config: r.config || DEFAULT_CONFIG });
    });

    // Serveur arbitre: valide, applique, diffuse
    socket.on('play:move', ({ code, col, row } = {}) => {
        const c = gameUtils.normalizeCode(code);
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
        const c = gameUtils.normalizeCode(code);
        handlePlayerDeparture(c);
        socket.leave(c);
    });

    socket.on('disconnect', () => {
        console.log('client disconnected:', socket.id);
        for (const [code, r] of rooms.entries()) {
            if (r.players.has(socket.id)) {
                handlePlayerDeparture(code);
            }
        }
    });

};