const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/*
 * =========================================================
 * DATABASE
 * =========================================================
 */

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL belum tersedia.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      code VARCHAR(11) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      room_code VARCHAR(11) NOT NULL
        REFERENCES rooms(code)
        ON DELETE CASCADE,
      username VARCHAR(24) NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_room_code
    ON messages(room_code);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_rooms_expires_at
    ON rooms(expires_at);
  `);

  console.log("PostgreSQL database initialized.");
}

/*
 * =========================================================
 * ROOM CONFIGURATION
 * =========================================================
 */

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

const ROOM_CODE_REGEX =
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}$/;

const USERNAME_REGEX = /^[A-Za-z0-9 _.'-]{1,24}$/;

const ROOM_CREATE_LIMIT = 5;
const ROOM_CREATE_WINDOW_MS = 10 * 60 * 1000;

const roomCreationTimestamps = new Map();
/*
 * Socket yang sedang berada di setiap room.
 * Ini memang tetap disimpan di memory karena
 * socket connection bersifat real-time.
 */

const roomSockets = new Map();

/*
 * =========================================================
 * GENERATE ROOM CODE
 * =========================================================
 */

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(9);

  let raw = "";

  for (const b of bytes) {
    raw += alphabet[b % alphabet.length];
  }

  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6, 9)}`;
}

/*
 * =========================================================
 * CLEANUP EXPIRED ROOMS
 * =========================================================
 */

async function cleanup() {
  try {
    const now = Date.now();

    /*
     * Ambil daftar room yang saat ini masih memiliki
     * socket/pengguna aktif.
     */
    const activeRoomCodes = [];

    for (const [code, sockets] of roomSockets) {
      if (sockets.size > 0) {
        activeRoomCodes.push(code);
      } else {
        /*
         * Tidak perlu menyimpan room kosong di memory.
         */
        roomSockets.delete(code);
      }
    }

    /*
     * Hapus room PostgreSQL yang:
     * - sudah melewati expires_at
     * - tidak sedang memiliki pengguna aktif
     *
     * Messages ikut terhapus otomatis karena
     * ON DELETE CASCADE pada tabel messages.
     */
    let result;

    if (activeRoomCodes.length === 0) {
      result = await pool.query(`
        DELETE FROM rooms
        WHERE expires_at <= NOW()
      `);
    } else {
      result = await pool.query(
        `
        DELETE FROM rooms
        WHERE expires_at <= NOW()
        AND NOT (code = ANY($1::text[]))
        `,
        [activeRoomCodes]
      );
    }

    console.log(
      `Cleanup completed at ${new Date(now).toISOString()} — ${result.rowCount} expired room(s) removed.`
    );

  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
}

setInterval(cleanup, 60_000);

function canCreateRoom(ip) {
  const now = Date.now();

  const previous = roomCreationTimestamps.get(ip) || [];

  const recent = previous.filter(
    (timestamp) => now - timestamp < ROOM_CREATE_WINDOW_MS
  );

  if (recent.length >= ROOM_CREATE_LIMIT) {
    roomCreationTimestamps.set(ip, recent);
    return false;
  }

  recent.push(now);
  roomCreationTimestamps.set(ip, recent);

  return true;
}

setInterval(() => {
  const now = Date.now();

  for (const [ip, timestamps] of roomCreationTimestamps) {
    const recent = timestamps.filter(
      (timestamp) => now - timestamp < ROOM_CREATE_WINDOW_MS
    );

    if (recent.length === 0) {
      roomCreationTimestamps.delete(ip);
    } else {
      roomCreationTimestamps.set(ip, recent);
    }
  }
}, 10 * 60 * 1000);

/*
 * =========================================================
 * CREATE ROOM
 * =========================================================
 */

app.post("/api/rooms", async (req, res) => {
  try {
    const ip = req.ip;

    if (!canCreateRoom(ip)) {
      return res.status(429).json({
        error: "Too many rooms created. Please try again later."
      });
    }

    let code;

    while (true) {
      code = generateCode();

      const existing = await pool.query(
        "SELECT code FROM rooms WHERE code = $1",
        [code]
      );

      if (existing.rowCount === 0) {
        break;
      }
    }

    const expiresAt = new Date(Date.now() + ROOM_TTL_MS);

    await pool.query(
      `
      INSERT INTO rooms (
        code,
        expires_at
      )
      VALUES ($1, $2)
      `,
      [code, expiresAt]
    );

    roomSockets.set(code, new Set());

    res.json({
      code,
      expiresAt: expiresAt.getTime()
    });
  } catch (error) {
    console.error("Create room error:", error);

    res.status(500).json({
      error: "Failed to create room."
    });
  }
});

/*
 * =========================================================
 * GET ROOM
 * =========================================================
 */

app.get("/api/rooms/:code", async (req, res) => {
  try {
    const code = String(req.params.code)
      .toUpperCase()
      .trim();

    if (!ROOM_CODE_REGEX.test(code)) {
      return res.status(400).json({
        error: "Invalid room code."
      });
    }

    const roomResult = await pool.query(
      `
      SELECT
        code,
        expires_at
      FROM rooms
      WHERE code = $1
      `,
      [code]
    );

    if (roomResult.rowCount === 0) {
      return res.status(404).json({
        error: "Room not found or expired."
      });
    }

    const room = roomResult.rows[0];

    if (new Date(room.expires_at).getTime() <= Date.now()) {
      await pool.query(
        "DELETE FROM rooms WHERE code = $1",
        [code]
      );

      roomSockets.delete(code);

      return res.status(404).json({
        error: "Room not found or expired."
      });
    }

    const messagesResult = await pool.query(
      `
      SELECT
        id,
        username,
        text,
        EXTRACT(EPOCH FROM created_at) * 1000 AS timestamp
      FROM messages
      WHERE room_code = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [code]
    );

    const messages = messagesResult.rows
      .reverse()
      .map((message) => ({
        id: message.id,
        username: message.username,
        text: message.text,
        timestamp: Number(message.timestamp)
      }));

    const sockets = roomSockets.get(code);

    res.json({
      code,
      expiresAt: new Date(room.expires_at).getTime(),
      participants: sockets ? sockets.size : 0,
      messages
    });
  } catch (error) {
    console.error("Get room error:", error);

    res.status(500).json({
      error: "Failed to get room."
    });
  }
});

/*
 * =========================================================
 * SOCKET.IO
 * =========================================================
 */

const MESSAGE_RATE_LIMIT = 5;
const MESSAGE_RATE_WINDOW_MS = 3000;
const messageTimestamps = new Map();

io.on("connection", (socket) => {

  /*
   * -------------------------------------------------------
   * JOIN ROOM
   * -------------------------------------------------------
   */

  socket.on("join-room", async ({ code, username }, ack) => {
  try {
    code = String(code || "")
      .toUpperCase()
      .trim();

    if (!ROOM_CODE_REGEX.test(code)) {
      return ack?.({
        ok: false,
        error: "Invalid room code."
      });
    }

    username = String(username || "").trim();

if (!USERNAME_REGEX.test(username)) {
  return ack?.({
    ok: false,
    error: "Invalid username. Use 1-24 letters, numbers, spaces, or . _ ' -"
  });
}

      const roomResult = await pool.query(
        `
        SELECT
          code,
          expires_at
        FROM rooms
        WHERE code = $1
        `,
        [code]
      );

      if (roomResult.rowCount === 0) {
        return ack?.({
          ok: false,
          error: "Room not found or expired."
        });
      }

      const room = roomResult.rows[0];

      if (
        new Date(room.expires_at).getTime() <= Date.now()
      ) {
        await pool.query(
          "DELETE FROM rooms WHERE code = $1",
          [code]
        );

        return ack?.({
          ok: false,
          error: "Room not found or expired."
        });
      }

      if (!roomSockets.has(code)) {
        roomSockets.set(code, new Set());
      }

      const sockets = roomSockets.get(code);

      /*
       * Maksimal 50 pengguna dalam satu room.
       */
      if (sockets.size >= 50) {
        return ack?.({
          ok: false,
          error: "Room is full (50 users maximum)."
        });
      }

      /*
       * Jangan masukkan socket yang sama dua kali.
       */
      if (sockets.has(socket.id)) {
        return ack?.({
          ok: true,
          code,
          username,
          expiresAt: new Date(room.expires_at).getTime(),
          participants: sockets.size
        });
      }

      socket.join(code);

      socket.data.roomCode = code;
      socket.data.username = username;

      sockets.add(socket.id);

      /*
       * Ambil 100 pesan terakhir dari PostgreSQL.
       */

      const messagesResult = await pool.query(
        `
        SELECT
          id,
          username,
          text,
          EXTRACT(EPOCH FROM created_at) * 1000 AS timestamp
        FROM messages
        WHERE room_code = $1
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [code]
      );

      const messages = messagesResult.rows
        .reverse()
        .map((message) => ({
          id: message.id,
          username: message.username,
          text: message.text,
          timestamp: Number(message.timestamp)
        }));

      ack?.({
        ok: true,
        code,
        username,
        expiresAt: new Date(room.expires_at).getTime(),
        participants: sockets.size,
        messages
      });

      socket.to(code).emit("presence", {
        participants: sockets.size
      });

      socket.to(code).emit("system-message", {
        text: `${username} joined the room.`,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error("Join room error:", error);

      ack?.({
        ok: false,
        error: "Failed to join room."
      });
    }
  });

  /*
 * -------------------------------------------------------
 * MESSAGE
 * -------------------------------------------------------
 */

socket.on("message", async ({ text }, ack) => {
  try {
    const now = Date.now();

    const previous = messageTimestamps.get(socket.id) || [];

    const recent = previous.filter(
      (timestamp) => now - timestamp < MESSAGE_RATE_WINDOW_MS
    );

    if (recent.length >= MESSAGE_RATE_LIMIT) {
      return ack?.({
        ok: false,
        error: "Too many messages. Please slow down."
      });
    }

    recent.push(now);
    messageTimestamps.set(socket.id, recent);

    const code = socket.data.roomCode;
    const username = socket.data.username;

    if (!code || !username) {
      return ack?.({
        ok: false,
        error: "Not in a room."
      });
    }

    const clean = String(text || "")
      .trim()
      .slice(0, 2000);

    if (!clean) {
      return ack?.({
        ok: false,
        error: "Empty message."
      });
    }

    const roomResult = await pool.query(
      `
      SELECT code
      FROM rooms
      WHERE code = $1
      AND expires_at > NOW()
      `,
      [code]
    );

    if (roomResult.rowCount === 0) {
      return ack?.({
        ok: false,
        error: "Room expired."
      });
    }

    const messageId = crypto.randomUUID();

    const messageResult = await pool.query(
      `
      INSERT INTO messages (
        id,
        room_code,
        username,
        text
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        username,
        text,
        EXTRACT(EPOCH FROM created_at) * 1000 AS timestamp
      `,
      [
        messageId,
        code,
        username,
        clean
      ]
    );

    const row = messageResult.rows[0];

    const message = {
      id: row.id,
      username: row.username,
      text: row.text,
      timestamp: Number(row.timestamp)
    };

    io.to(code).emit("message", message);

    await pool.query(
      `
      DELETE FROM messages
      WHERE room_code = $1
      AND id NOT IN (
        SELECT id
        FROM messages
        WHERE room_code = $1
        ORDER BY created_at DESC
        LIMIT 200
      )
      `,
      [code]
    );

    ack?.({
      ok: true
    });

  } catch (error) {
    console.error("Message error:", error);

    ack?.({
      ok: false,
      error: "Failed to send message."
    });
  }
});

  /*
   * -------------------------------------------------------
   * TYPING
   * -------------------------------------------------------
   */

  socket.on("typing", (isTyping) => {
    const code = socket.data.roomCode;

    if (code) {
      socket.to(code).emit("typing", {
        username: socket.data.username,
        isTyping: !!isTyping
      });
    }
  });

  /*
 * -------------------------------------------------------
 * LEAVE ROOM
 * -------------------------------------------------------
 */

socket.on("leave-room", () => {
  const code = socket.data.roomCode;
  const username = socket.data.username;

  if (!code) return;

  const sockets = roomSockets.get(code);

  if (sockets) {
    sockets.delete(socket.id);

    socket.to(code).emit("presence", {
      participants: sockets.size
    });

    socket.to(code).emit("system-message", {
      text: `${username || "Guest"} left the room.`,
      timestamp: Date.now()
    });

    /*
     * Jika sudah tidak ada pengguna,
     * hapus Set room dari memory.
     */
    if (sockets.size === 0) {
      roomSockets.delete(code);
    }
  }

  socket.leave(code);

  socket.data.roomCode = null;
  socket.data.username = null;

  /*
   * Bersihkan rate-limit message milik socket ini.
   */
  messageTimestamps.delete(socket.id);
});

/*
 * -------------------------------------------------------
 * DISCONNECT
 * -------------------------------------------------------
 */

socket.on("disconnect", () => {
  messageTimestamps.delete(socket.id);

  const code = socket.data.roomCode;

  if (!code) return;

  const sockets = roomSockets.get(code);

  if (sockets) {
    sockets.delete(socket.id);

    socket.to(code).emit("presence", {
      participants: sockets.size
    });

    /*
     * Jangan biarkan Set kosong tersimpan di memory.
     */
    if (sockets.size === 0) {
      roomSockets.delete(code);
    }
  }

  socket.data.roomCode = null;
  socket.data.username = null;
});

/*
 * =========================================================
 * FRONTEND FALLBACK
 * =========================================================
 */

app.use((req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/*
 * =========================================================
 * START SERVER
 * =========================================================
 */

async function startServer() {
  try {
    await initializeDatabase();

    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `CodeConnect running on port ${PORT}`
      );
    });

  } catch (error) {
    console.error(
      "Failed to start CodeConnect:",
      error
    );

    process.exit(1);
  }
}

startServer();
