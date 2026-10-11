const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const {
  createDeck, shuffle, evaluateHand, compareHands, isFoul, chooseAceOfDiamondsDealer
} = require("./src/game");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const players = new Map();
const STARTING_CREDITS = 0;
const BET_OPTIONS = [5, 10, 15];

function roomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function publicPlayer(p) {
  return { id: p.id, name: p.name, credits: p.credits, isHost: p.isHost, isBot: !!p.isBot };
}
function roomSummary(room) {
  return {
    code: room.code, mode: room.mode, status: room.status,
    hostId: room.hostId, dealerId: room.dealerId, roundNumber: room.roundNumber,
    players: room.players.map(publicPlayer), maxPlayers: 4,
    bet: room.bet || null, phase: room.phase || null,
    deadline: room.deadline || null
  };
}
function emitRoom(room) {
  io.to(room.code).emit("room:update", roomSummary(room));
}
function emitError(socket, message) {
  socket.emit("app:error", { message });
}
function getPlayerRoom(playerId) {
  const p = players.get(playerId);
  return p && p.roomCode ? rooms.get(p.roomCode) : null;
}
function removePlayerFromRoom(socketId) {
  const p = players.get(socketId);
  if (!p || !p.roomCode) return;
  const room = rooms.get(p.roomCode);
  if (room) {
    room.players = room.players.filter(x => x.id !== socketId);
    if (room.hostId === socketId) room.hostId = room.players.find(x => !x.isBot)?.id || null;
    if (room.dealerId === socketId) room.dealerId = room.players.find(x => !x.isBot)?.id || null;
    if (!room.players.length) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
    } else {
      emitRoom(room);
    }
  }
  p.roomCode = null;
}
function createPlayer(socket, name) {
  const safeName = String(name || "Player").trim().slice(0, 18) || "Player";
  const p = { id: socket.id, name: safeName, credits: STARTING_CREDITS, isHost: false, roomCode: null, isBot: false, history: [] };
  players.set(socket.id, p);
  return p;
}
function addBot(room, n) {
  const bot = {
    id: `bot-${crypto.randomBytes(3).toString("hex")}`, name: `Bot ${n}`,
    credits: 100, isHost: false, roomCode: room.code, isBot: true, history: []
  };
  room.players.push(bot);
}
function createRoom(owner, mode) {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = {
    code, mode, hostId: owner.id, dealerId: null, players: [owner],
    status: "lobby", phase: "lobby", roundNumber: 0, completedRoundsForDealer: 0,
    bet: null, hands: {}, submissions: {}, timer: null, deadline: null, createdAt: Date.now()
  };
  owner.roomCode = code;
  owner.isHost = true;
  rooms.set(code, room);
  return room;
}
function startRound(room) {
  if (!room || room.status === "playing") return;
  const active = room.players.filter(p => p.isBot || players.has(p.id));
  if (active.length < 2) return;
  room.players = active;
  room.status = "playing";
  room.phase = "betting";
  room.roundNumber += 1;
  room.bet = null;
  room.submissions = {};
  room.hands = {};
  room.deck = shuffle(createDeck());
  room.deadline = Date.now() + 12000;

  if (room.mode === "dealer" && room.dealerId) {
    const currentIndex = room.players.findIndex(p => p.id === room.dealerId);
    if (room.completedRoundsForDealer >= 3) {
      room.dealerId = room.players[(currentIndex + 1 + room.players.length) % room.players.length].id;
      room.completedRoundsForDealer = 0;
    }
  } else if (!room.dealerId) {
    room.dealerId = room.players[0].id;
  }
  // Deal 13 cards to each seat from the shuffled deck.
  let idx = 0;
  for (const p of room.players) room.hands[p.id] = room.deck.slice(idx, idx += 13);
  if (room.mode === "ace") {
    const holder = room.players.find(p => (room.hands[p.id] || []).includes("AD"));
    if (holder) room.dealerId = holder.id;
  }
  io.to(room.code).emit("round:started", {
    room: roomSummary(room),
    hands: Object.fromEntries(room.players.filter(p => !p.isBot).map(p => [p.id, room.hands[p.id]])),
    phase: "betting", deadline: room.deadline
  });
  emitRoom(room);
  clearTimeout(room.timer);
  room.timer = setTimeout(() => beginArrangement(room), 12000);
}
function beginArrangement(room) {
  if (!rooms.has(room.code) || room.phase !== "betting") return;
  room.phase = "arranging";
  room.deadline = Date.now() + 90000;
  io.to(room.code).emit("round:phase", { phase: "arranging", deadline: room.deadline });
  // Simple bot submissions: first 3 / next 5 / final 5. This is a placeholder strategy.
  for (const p of room.players.filter(p => p.isBot)) {
    const hand = room.hands[p.id] || [];
    room.submissions[p.id] = { front: hand.slice(0,3), middle: hand.slice(3,8), back: hand.slice(8,13) };
  }
  clearTimeout(room.timer);
  room.timer = setTimeout(() => finishRound(room), 90000);
}
function allSubmitted(room) {
  return room.players.every(p => room.submissions[p.id]);
}
function rankSubmission(sub) {
  return {
    front: evaluateHand(sub.front),
    middle: evaluateHand(sub.middle),
    back: evaluateHand(sub.back),
    foul: isFoul(sub.front, sub.middle, sub.back)
  };
}
function scoreRound(room) {
  const result = {};
  for (const p of room.players) result[p.id] = { id: p.id, name: p.name, delta: 0, rows: {}, foul: false };
  const ranked = {};
  for (const p of room.players) {
    const sub = room.submissions[p.id];
    if (!sub) {
      const h = room.hands[p.id] || [];
      room.submissions[p.id] = { front: h.slice(0,3), middle: h.slice(3,8), back: h.slice(8,13) };
    }
    ranked[p.id] = rankSubmission(room.submissions[p.id]);
    result[p.id].foul = ranked[p.id].foul;
  }

  for (let i = 0; i < room.players.length; i++) {
    for (let j = i + 1; j < room.players.length; j++) {
      const a = room.players[i], b = room.players[j];
      if (ranked[a.id].foul && !ranked[b.id].foul) {
        result[a.id].delta -= room.bet * 3; result[b.id].delta += room.bet * 3; continue;
      }
      if (ranked[b.id].foul && !ranked[a.id].foul) {
        result[b.id].delta -= room.bet * 3; result[a.id].delta += room.bet * 3; continue;
      }
      if (ranked[a.id].foul && ranked[b.id].foul) continue;
      let aWins = 0, bWins = 0;
      for (const row of ["front", "middle", "back"]) {
        const cmp = compareHands(ranked[a.id][row], ranked[b.id][row]);
        result[a.id].rows[b.id] ||= {};
        result[b.id].rows[a.id] ||= {};
        result[a.id].rows[b.id][row] = cmp;
        result[b.id].rows[a.id][row] = -cmp;
        if (cmp > 0) aWins++;
        if (cmp < 0) bWins++;
      }
      const delta = room.bet * (aWins === 3 ? 3 : bWins === 3 ? -3 : aWins - bWins);
      result[a.id].delta += delta;
      result[b.id].delta -= delta;
    }
  }
  // Four-of-a-kind or straight-flush bonus: demo bonus for the back 5-card hand.
  for (const p of room.players) {
    const back = room.submissions[p.id].back;
    const e = evaluateHand(back);
    if (!ranked[p.id].foul && (e.category === 7 || e.category === 8)) result[p.id].delta += room.bet * 2;
  }
  return result;
}
function finishRound(room) {
  if (!rooms.has(room.code) || room.phase === "results") return;
  clearTimeout(room.timer);
  room.phase = "results";
  room.status = "results";
  room.deadline = null;
  const results = scoreRound(room);
  for (const p of room.players) {
    const delta = results[p.id]?.delta || 0;
    p.credits = Math.max(0, p.credits + delta);
    if (!p.isBot) {
      p.history ||= [];
      p.history.unshift({ round: room.roundNumber, mode: room.mode, delta, at: Date.now() });
      p.history = p.history.slice(0, 30);
    }
  }
  if (room.mode === "dealer") room.completedRoundsForDealer++;
  io.to(room.code).emit("round:results", {
    room: roomSummary(room), results,
    hands: Object.fromEntries(room.players.filter(p => !p.isBot).map(p => [p.id, room.submissions[p.id]])),
    nextRoundAvailable: true
  });
  emitRoom(room);
}
io.on("connection", socket => {
  socket.on("player:register", ({ name } = {}) => {
    const p = createPlayer(socket, name);
    socket.emit("player:ready", { player: publicPlayer(p) });
  });

  socket.on("wallet:deposit-demo", ({ amount } = {}) => {
    const p = players.get(socket.id);
    if (!p) return emitError(socket, "Please set your player name first.");
    const n = Number(amount);
    if (![100, 500, 1000].includes(n)) return emitError(socket, "Choose 100, 500, or 1,000 demo credits.");
    p.credits += n;
    socket.emit("wallet:update", { credits: p.credits, message: `${n} demo credits added. They have no cash value.` });
    const room = getPlayerRoom(socket.id);
    if (room) emitRoom(room);
  });

  socket.on("room:create", ({ mode } = {}) => {
    const p = players.get(socket.id);
    if (!p) return emitError(socket, "Please set your player name first.");
    if (p.roomCode) removePlayerFromRoom(socket.id);
    const validModes = ["private", "ace", "dealer", "bot"];
    if (!validModes.includes(mode)) mode = "private";
    const room = createRoom(p, mode);
    socket.join(room.code);
    if (mode === "bot") {
      addBot(room, 1); addBot(room, 2); addBot(room, 3);
    }
    socket.emit("room:created", { room: roomSummary(room) });
    emitRoom(room);
  });

  socket.on("room:join", ({ code } = {}) => {
    const p = players.get(socket.id);
    if (!p) return emitError(socket, "Please set your player name first.");
    const room = rooms.get(String(code || "").trim().toUpperCase());
    if (!room) return emitError(socket, "Room not found. Check the room code.");
    if (room.status !== "lobby") return emitError(socket, "This room has already started.");
    if (room.players.length >= 4) return emitError(socket, "This room is full.");
    if (p.roomCode) removePlayerFromRoom(socket.id);
    p.roomCode = room.code; p.isHost = false;
    room.players.push(p);
    socket.join(room.code);
    socket.emit("room:joined", { room: roomSummary(room) });
    emitRoom(room);
  });

  socket.on("room:start", () => {
    const room = getPlayerRoom(socket.id);
    if (!room) return emitError(socket, "Join a room first.");
    if (room.hostId !== socket.id) return emitError(socket, "Only the room host can start the game.");
    if (room.players.filter(p => !p.isBot).length < 2 && room.mode !== "bot")
      return emitError(socket, "Invite at least one more player before starting.");
    startRound(room);
  });

  socket.on("round:bet", ({ bet } = {}) => {
    const room = getPlayerRoom(socket.id);
    const p = players.get(socket.id);
    if (!room || room.phase !== "betting") return emitError(socket, "The betting phase is closed.");
    if (!BET_OPTIONS.includes(Number(bet))) return emitError(socket, "Choose a bet of 5, 10, or 15 credits.");
    if (p.credits < Number(bet)) return emitError(socket, "Not enough virtual credits. Open Coin Deposit to add demo credits.");
    room.bet = Number(bet);
    io.to(room.code).emit("round:bet-update", { bet: room.bet, by: p.name });
  });

  socket.on("round:submit", ({ front, middle, back } = {}) => {
    const room = getPlayerRoom(socket.id);
    if (!room || room.phase !== "arranging") return emitError(socket, "The arrangement phase is not active.");
    const hand = room.hands[socket.id] || [];
    const cards = [...(front || []), ...(middle || []), ...(back || [])];
    if (cards.length !== 13 || new Set(cards).size !== 13 || cards.some(c => !hand.includes(c))) {
      return emitError(socket, "Arrange all 13 dealt cards exactly once.");
    }
    if (front.length !== 3 || middle.length !== 5 || back.length !== 5) {
      return emitError(socket, "Front must have 3 cards, Middle 5, and Back 5.");
    }
    room.submissions[socket.id] = { front, middle, back };
    socket.emit("round:submitted", { ok: true });
    if (allSubmitted(room)) finishRound(room);
  });

  socket.on("round:next", () => {
    const room = getPlayerRoom(socket.id);
    if (!room || room.phase !== "results") return emitError(socket, "The previous round is not finished.");
    if (room.hostId !== socket.id) return emitError(socket, "Only the room host can start the next round.");
    startRound(room);
  });

  socket.on("wallet:history", () => {
    const p = players.get(socket.id);
    socket.emit("wallet:history-data", { history: p?.history || [], credits: p?.credits || 0 });
  });

  socket.on("room:leave", () => {
    const room = getPlayerRoom(socket.id);
    if (room) socket.leave(room.code);
    removePlayerFromRoom(socket.id);
    socket.emit("room:left");
  });

  socket.on("disconnect", () => {
    removePlayerFromRoom(socket.id);
    players.delete(socket.id);
  });
});

server.listen(PORT, () => console.log(`Ace Room running on port ${PORT}`));
