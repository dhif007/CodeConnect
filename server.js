const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(9);
  let raw = "";
  for (const b of bytes) raw += alphabet[b % alphabet.length];
  return `${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6,9)}`;
}

function cleanup() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.expiresAt <= now && room.sockets.size === 0) rooms.delete(code);
  }
}
setInterval(cleanup, 60_000);

app.post("/api/rooms", (req, res) => {
  let code;
  do code = generateCode(); while (rooms.has(code));
  rooms.set(code, {
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + ROOM_TTL_MS,
    sockets: new Set(),
    messages: []
  });
  res.json({ code, expiresAt: rooms.get(code).expiresAt });
});

app.get("/api/rooms/:code", (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const room = rooms.get(code);
  if (!room || room.expiresAt <= Date.now()) {
    if (room) rooms.delete(code);
    return res.status(404).json({ error: "Room not found or expired." });
  }
  res.json({
    code,
    expiresAt: room.expiresAt,
    participants: room.sockets.size,
    messages: room.messages.slice(-100)
  });
});

io.on("connection", (socket) => {
  socket.on("join-room", ({ code, username }, ack) => {
    code = String(code || "").toUpperCase().trim();
    username = String(username || "Guest").trim().slice(0, 24) || "Guest";

    const room = rooms.get(code);
    if (!room || room.expiresAt <= Date.now()) {
      return ack?.({ ok: false, error: "Room not found or expired." });
    }
    if (room.sockets.size >= 2) {
      return ack?.({ ok: false, error: "This free room is full (2 users)." });
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.username = username;
    room.sockets.add(socket.id);

    ack?.({
      ok: true,
      code,
      username,
      expiresAt: room.expiresAt,
      participants: room.sockets.size,
      messages: room.messages.slice(-100)
    });

    socket.to(code).emit("presence", { participants: room.sockets.size });
    socket.to(code).emit("system-message", {
      text: `${username} joined the room.`,
      timestamp: Date.now()
    });
  });

  socket.on("message", ({ text }, ack) => {
    const code = socket.data.roomCode;
    const username = socket.data.username;
    const room = rooms.get(code);
    if (!room || !username) return ack?.({ ok: false, error: "Not in a room." });

    const clean = String(text || "").trim().slice(0, 2000);
    if (!clean) return ack?.({ ok: false, error: "Empty message." });

    const message = {
      id: crypto.randomUUID(),
      username,
      text: clean,
      timestamp: Date.now()
    };
    room.messages.push(message);
    if (room.messages.length > 200) room.messages.shift();

    io.to(code).emit("message", message);
    ack?.({ ok: true });
  });

  socket.on("typing", (isTyping) => {
    const code = socket.data.roomCode;
    if (code) socket.to(code).emit("typing", {
      username: socket.data.username,
      isTyping: !!isTyping
    });
  });

  socket.on("leave-room", () => {
    const code = socket.data.roomCode;
    const username = socket.data.username;
    if (!code) return;
    const room = rooms.get(code);
    if (room) {
      room.sockets.delete(socket.id);
      socket.to(code).emit("presence", { participants: room.sockets.size });
      socket.to(code).emit("system-message", {
        text: `${username || "Guest"} left the room.`,
        timestamp: Date.now()
      });
    }
    socket.leave(code);
    socket.data.roomCode = null;
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (room) {
      room.sockets.delete(socket.id);
      socket.to(code).emit("presence", { participants: room.sockets.size });
    }
  });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`CodeConnect running at http://localhost:${PORT}`);
});