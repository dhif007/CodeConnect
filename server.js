const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const webpush = require("web-push");

const app = express();

app.set("trust proxy", 1);

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/*
 * =========================================================
 * WEB PUSH / VAPID
 * =========================================================
 */

if (
  !process.env.VAPID_PUBLIC_KEY ||
  !process.env.VAPID_PRIVATE_KEY ||
  !process.env.VAPID_SUBJECT
) {
  console.error(
    "ERROR: VAPID configuration is missing."
  );

  process.exit(1);
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/*
 * =========================================================
 * EXPRESS
 * =========================================================
 */

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/*
 * =========================================================
 * DATABASE
 * =========================================================
 */

if (!process.env.DATABASE_URL) {
  console.error(
    "ERROR: DATABASE_URL belum tersedia."
  );

  process.exit(1);
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,

  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: false
        }
      : false
});

/*
 * =========================================================
 * INITIALIZE DATABASE
 * =========================================================
 */

async function initializeDatabase() {

  /*
   * ROOMS
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      code VARCHAR(11) PRIMARY KEY,
      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),
      expires_at TIMESTAMPTZ
        NOT NULL
    );
  `);

  /*
   * MESSAGES
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,

      room_code VARCHAR(11)
        NOT NULL
        REFERENCES rooms(code)
        ON DELETE CASCADE,

      username VARCHAR(24)
        NOT NULL,

      text TEXT
        NOT NULL,

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
    );
  `);

  /*
   * PUSH SUBSCRIPTIONS
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGSERIAL PRIMARY KEY,

      endpoint TEXT
        UNIQUE
        NOT NULL,

      p256dh TEXT
        NOT NULL,

      auth TEXT
        NOT NULL,

      room_code VARCHAR(11)
        REFERENCES rooms(code)
        ON DELETE CASCADE,

      username VARCHAR(24),

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

      updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
    );
  `);

  /*
   * INDEX: MESSAGES
   */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      idx_messages_room_code

    ON messages(room_code);
  `);

  /*
   * INDEX: ROOMS
   */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      idx_rooms_expires_at

    ON rooms(expires_at);
  `);

  /*
   * INDEX: PUSH SUBSCRIPTIONS
   */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      idx_push_subscriptions_room

    ON push_subscriptions(room_code);
  `);

  console.log(
    "PostgreSQL database initialized."
  );
}

/*
 * =========================================================
 * ROOM CONFIGURATION
 * =========================================================
 */

const ROOM_TTL_MS =
  24 * 60 * 60 * 1000;

const ROOM_CODE_REGEX =
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}$/;

const USERNAME_REGEX =
  /^[A-Za-z0-9 _.'-]{1,24}$/;

const ROOM_CREATE_LIMIT = 5;

const ROOM_CREATE_WINDOW_MS =
  10 * 60 * 1000;

const roomCreationTimestamps =
  new Map();

/*
 * Socket yang sedang berada
 * di setiap room.
 */

const roomSockets =
  new Map();

/*
 * =========================================================
 * GENERATE ROOM CODE
 * =========================================================
 */

function generateCode() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const bytes =
    crypto.randomBytes(9);

  let raw = "";

  for (const byte of bytes) {
    raw +=
      alphabet[
        byte % alphabet.length
      ];
  }

  return (
    `${raw.slice(0, 3)}-` +
    `${raw.slice(3, 6)}-` +
    `${raw.slice(6, 9)}`
  );
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
     * Daftar room yang masih
     * memiliki user aktif.
     */

    const activeRoomCodes = [];

    for (
      const [code, sockets]
      of roomSockets
    ) {
      if (sockets.size > 0) {
        activeRoomCodes.push(code);
      } else {
        roomSockets.delete(code);
      }
    }

    let result;

    /*
     * Jika tidak ada room aktif.
     */

    if (
      activeRoomCodes.length === 0
    ) {
      result =
        await pool.query(`
          DELETE FROM rooms
          WHERE expires_at <= NOW()
        `);

    } else {

      /*
       * Jangan hapus room yang
       * masih digunakan socket aktif.
       */

      result =
        await pool.query(
          `
          DELETE FROM rooms

          WHERE expires_at <= NOW()

          AND NOT (
            code = ANY($1::text[])
          )
          `,
          [
            activeRoomCodes
          ]
        );
    }

    console.log(
      `Cleanup completed at ` +
      `${new Date(now).toISOString()} — ` +
      `${result.rowCount} expired room(s) removed.`
    );

  } catch (error) {
    console.error(
      "Cleanup error:",
      error.message
    );
  }
}

setInterval(
  cleanup,
  60_000
);

/*
 * =========================================================
 * ROOM CREATE RATE LIMIT
 * =========================================================
 */

function canCreateRoom(ip) {
  const now = Date.now();

  const previous =
    roomCreationTimestamps
      .get(ip) || [];

  const recent =
    previous.filter(
      (timestamp) =>
        now - timestamp <
        ROOM_CREATE_WINDOW_MS
    );

  if (
    recent.length >=
    ROOM_CREATE_LIMIT
  ) {
    roomCreationTimestamps.set(
      ip,
      recent
    );

    return false;
  }

  recent.push(now);

  roomCreationTimestamps.set(
    ip,
    recent
  );

  return true;
}

/*
 * Bersihkan memory rate-limit
 * setiap 10 menit.
 */

setInterval(() => {
  const now = Date.now();

  for (
    const [ip, timestamps]
    of roomCreationTimestamps
  ) {
    const recent =
      timestamps.filter(
        (timestamp) =>
          now - timestamp <
          ROOM_CREATE_WINDOW_MS
      );

    if (
      recent.length === 0
    ) {
      roomCreationTimestamps
        .delete(ip);

    } else {

      roomCreationTimestamps
        .set(
          ip,
          recent
        );
    }
  }

}, 10 * 60 * 1000);

/*
 * =========================================================
 * CREATE ROOM
 * =========================================================
 */

app.post(
  "/api/rooms",
  async (req, res) => {
    try {
      const ip = req.ip;

      if (
        !canCreateRoom(ip)
      ) {
        return res
          .status(429)
          .json({
            error:
              "Too many rooms created. Please try again later."
          });
      }

      let code;

      /*
       * Pastikan room code unik.
       */

      while (true) {
        code =
          generateCode();

        const existing =
          await pool.query(
            `
            SELECT code
            FROM rooms
            WHERE code = $1
            `,
            [
              code
            ]
          );

        if (
          existing.rowCount === 0
        ) {
          break;
        }
      }

      const expiresAt =
        new Date(
          Date.now() +
          ROOM_TTL_MS
        );

      await pool.query(
        `
        INSERT INTO rooms (
          code,
          expires_at
        )

        VALUES ($1, $2)
        `,
        [
          code,
          expiresAt
        ]
      );

      roomSockets.set(
        code,
        new Set()
      );

      res.json({
        code,
        expiresAt:
          expiresAt.getTime()
      });

    } catch (error) {
      console.error(
        "Create room error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to create room."
        });
    }
  }
);

/*
 * =========================================================
 * GET ROOM
 * =========================================================
 */

app.get(
  "/api/rooms/:code",
  async (req, res) => {
    try {
      const code =
        String(
          req.params.code
        )
          .toUpperCase()
          .trim();

      if (
        !ROOM_CODE_REGEX
          .test(code)
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid room code."
          });
      }

      const roomResult =
        await pool.query(
          `
          SELECT
            code,
            expires_at

          FROM rooms

          WHERE code = $1
          `,
          [
            code
          ]
        );

      if (
        roomResult.rowCount === 0
      ) {
        return res
          .status(404)
          .json({
            error:
              "Room not found or expired."
          });
      }

      const room =
        roomResult.rows[0];

      /*
       * Room expired.
       */

      if (
        new Date(
          room.expires_at
        ).getTime() <=
        Date.now()
      ) {
        await pool.query(
          `
          DELETE FROM rooms
          WHERE code = $1
          `,
          [
            code
          ]
        );

        roomSockets.delete(
          code
        );

        return res
          .status(404)
          .json({
            error:
              "Room not found or expired."
          });
      }

      /*
       * Ambil 100 pesan terakhir.
       */

      const messagesResult =
        await pool.query(
          `
          SELECT
            id,
            username,
            text,

            EXTRACT(
              EPOCH FROM created_at
            ) * 1000
              AS timestamp

          FROM messages

          WHERE room_code = $1

          ORDER BY
            created_at DESC

          LIMIT 100
          `,
          [
            code
          ]
        );

      const messages =
        messagesResult.rows
          .reverse()
          .map(
            (message) => ({
              id:
                message.id,

              username:
                message.username,

              text:
                message.text,

              timestamp:
                Number(
                  message.timestamp
                )
            })
          );

      const sockets =
        roomSockets.get(code);

      res.json({
        code,

        expiresAt:
          new Date(
            room.expires_at
          ).getTime(),

        participants:
          sockets
            ? sockets.size
            : 0,

        messages
      });

    } catch (error) {
      console.error(
        "Get room error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to get room."
        });
    }
  }
);

/*
 * =========================================================
 * ROOM QR CODE
 * =========================================================
 */

app.get(
  "/api/qr/:code",
  async (req, res) => {
    try {
      const code =
        String(
          req.params.code ||
          ""
        )
          .toUpperCase()
          .trim();

      if (
        !ROOM_CODE_REGEX
          .test(code)
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid room code."
          });
      }

      const inviteUrl =
        `${req.protocol}://` +
        `${req.get("host")}/` +
        `?join=` +
        `${encodeURIComponent(code)}`;

      const qrBuffer =
        await QRCode.toBuffer(
          inviteUrl,
          {
            type: "png",
            width: 220,
            margin: 2,

            errorCorrectionLevel:
              "M"
          }
        );

      res.set(
        "Content-Type",
        "image/png"
      );

      res.set(
        "Cache-Control",
        "no-store"
      );

      res.send(
        qrBuffer
      );

    } catch (error) {
      console.error(
        "QR generation error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to generate QR code."
        });
    }
  }
);

/*
 * =========================================================
 * PUSH PUBLIC KEY
 * =========================================================
 */

app.get(
  "/api/push/public-key",
  (req, res) => {
    res.json({
      publicKey:
        process.env
          .VAPID_PUBLIC_KEY
    });
  }
);

/*
 * =========================================================
 * SAVE PUSH SUBSCRIPTION
 * =========================================================
 */

app.post(
  "/api/push/subscribe",
  async (req, res) => {
    try {
      const {
        subscription,
        roomCode,
        username
      } =
        req.body || {};

      /*
       * Validasi subscription.
       */

      if (
        !subscription ||
        !subscription.endpoint ||
        !subscription.keys ||
        !subscription.keys.p256dh ||
        !subscription.keys.auth
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid push subscription."
          });
      }

      const cleanRoomCode =
        String(
          roomCode || ""
        )
          .toUpperCase()
          .trim();

      const cleanUsername =
        String(
          username || ""
        )
          .trim();

      if (
        !ROOM_CODE_REGEX
          .test(
            cleanRoomCode
          )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid room code."
          });
      }

      if (
        !USERNAME_REGEX
          .test(
            cleanUsername
          )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid username."
          });
      }

      /*
       * Pastikan room masih hidup.
       */

      const roomResult =
        await pool.query(
          `
          SELECT code

          FROM rooms

          WHERE code = $1
          AND expires_at > NOW()
          `,
          [
            cleanRoomCode
          ]
        );

      if (
        roomResult.rowCount === 0
      ) {
        return res
          .status(404)
          .json({
            error:
              "Room not found or expired."
          });
      }

      /*
       * Simpan subscription.
       *
       * endpoint UNIQUE sehingga
       * satu device tidak menghasilkan
       * duplikasi terus-menerus.
       */

      await pool.query(
        `
        INSERT INTO
          push_subscriptions (
            endpoint,
            p256dh,
            auth,
            room_code,
            username,
            updated_at
          )

        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          NOW()
        )

        ON CONFLICT (endpoint)

        DO UPDATE SET
          p256dh =
            EXCLUDED.p256dh,

          auth =
            EXCLUDED.auth,

          room_code =
            EXCLUDED.room_code,

          username =
            EXCLUDED.username,

          updated_at =
            NOW()
        `,
        [
          subscription.endpoint,

          subscription
            .keys
            .p256dh,

          subscription
            .keys
            .auth,

          cleanRoomCode,

          cleanUsername
        ]
      );

      res.json({
        ok: true
      });

    } catch (error) {
      console.error(
        "Push subscription error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to save push subscription."
        });
    }
  }
);
/*
 * =========================================================
 * SEND PUSH TO ROOM
 * =========================================================
 */

async function sendPushToRoom(
  roomCode,
  senderUsername,
  messageText
) {
  try {
    const result =
      await pool.query(
        `
        SELECT
          endpoint,
          p256dh,
          auth,
          username

        FROM push_subscriptions

        WHERE room_code = $1
        `,
        [roomCode]
      );

    if (
      result.rowCount === 0
    ) {
      return;
    }

    const payload =
      JSON.stringify({
        title:
          `${senderUsername} · CodeConnect`,

        body:
          messageText.length > 120
            ? `${messageText.slice(0, 117)}...`
            : messageText,

        roomCode,

        url:
          `/?join=${encodeURIComponent(
            roomCode
          )}`,

        tag:
          `codeconnect-${roomCode}`
      });

    const jobs =
      result.rows.map(
        async (row) => {

          /*
           * Jangan kirim notifikasi
           * kembali ke username pengirim.
           */
          if (
            row.username ===
            senderUsername
          ) {
            return;
          }

          const subscription = {
            endpoint:
              row.endpoint,

            keys: {
              p256dh:
                row.p256dh,

              auth:
                row.auth
            }
          };

          try {
            await webpush.sendNotification(
              subscription,
              payload,
              {
                TTL: 60 * 60,
                urgency: "high"
              }
            );

          } catch (error) {
            console.error(
              "Push send error:",
              error.statusCode ||
              error.message
            );

            /*
             * 404 / 410 biasanya berarti
             * subscription sudah tidak valid.
             * Hapus supaya database tetap bersih.
             */
            if (
              error.statusCode === 404 ||
              error.statusCode === 410
            ) {
              await pool.query(
                `
                DELETE FROM push_subscriptions
                WHERE endpoint = $1
                `,
                [
                  row.endpoint
                ]
              );
            }
          }
        }
      );

    await Promise.allSettled(
      jobs
    );

  } catch (error) {
    console.error(
      "Push room error:",
      error
    );
  }
}
/*
 * =========================================================
 * SOCKET.IO CONFIGURATION
 * =========================================================
 */

const MESSAGE_RATE_LIMIT =
  5;

const MESSAGE_RATE_WINDOW_MS =
  3000;

const messageTimestamps =
  new Map();

/*
 * =========================================================
 * SOCKET.IO
 * =========================================================
 */

io.on(
  "connection",
  (socket) => {

    /*
     * -------------------------------------------------------
     * JOIN ROOM
     * -------------------------------------------------------
     */

    socket.on(
      "join-room",
      async (
        {
          code,
          username
        },
        ack
      ) => {
        try {
          code =
            String(
              code || ""
            )
              .toUpperCase()
              .trim();

          if (
            !ROOM_CODE_REGEX
              .test(code)
          ) {
            return ack?.({
              ok: false,

              error:
                "Invalid room code."
            });
          }

          username =
            String(
              username || ""
            )
              .trim();

          if (
            !USERNAME_REGEX
              .test(username)
          ) {
            return ack?.({
              ok: false,

              error:
                "Invalid username. Use 1-24 letters, numbers, spaces, or . _ ' -"
            });
          }

          /*
           * Ambil room.
           */

          const roomResult =
            await pool.query(
              `
              SELECT
                code,
                expires_at

              FROM rooms

              WHERE code = $1
              `,
              [
                code
              ]
            );

          if (
            roomResult
              .rowCount === 0
          ) {
            return ack?.({
              ok: false,

              error:
                "Room not found or expired."
            });
          }

          const room =
            roomResult.rows[0];

          /*
           * Room expired.
           */

          if (
            new Date(
              room.expires_at
            ).getTime() <=
            Date.now()
          ) {
            await pool.query(
              `
              DELETE FROM rooms
              WHERE code = $1
              `,
              [
                code
              ]
            );

            roomSockets
              .delete(code);

            return ack?.({
              ok: false,

              error:
                "Room not found or expired."
            });
          }

          /*
           * Buat memory room
           * jika belum tersedia.
           */

          if (
            !roomSockets
              .has(code)
          ) {
            roomSockets.set(
              code,
              new Set()
            );
          }

          const sockets =
            roomSockets.get(
              code
            );

          /*
           * Maksimal 50 user.
           */

          if (
            sockets.size >= 50
          ) {
            return ack?.({
              ok: false,

              error:
                "Room is full (50 users maximum)."
            });
          }

          /*
           * Socket sama tidak
           * boleh dimasukkan dua kali.
           */

          if (
            sockets.has(
              socket.id
            )
          ) {
            return ack?.({
              ok: true,

              code,
              username,

              expiresAt:
                new Date(
                  room.expires_at
                ).getTime(),

              participants:
                sockets.size
            });
          }

          socket.join(
            code
          );

          socket.data.roomCode =
            code;

          socket.data.username =
            username;

          sockets.add(
            socket.id
          );

          /*
           * Ambil 100 pesan terakhir.
           */

          const messagesResult =
            await pool.query(
              `
              SELECT
                id,
                username,
                text,

                EXTRACT(
                  EPOCH FROM created_at
                ) * 1000
                  AS timestamp

              FROM messages

              WHERE room_code = $1

              ORDER BY
                created_at DESC

              LIMIT 100
              `,
              [
                code
              ]
            );

          const messages =
            messagesResult.rows
              .reverse()
              .map(
                (message) => ({
                  id:
                    message.id,

                  username:
                    message.username,

                  text:
                    message.text,

                  timestamp:
                    Number(
                      message.timestamp
                    )
                })
              );

          /*
           * Response untuk user
           * yang baru join.
           */

          ack?.({
            ok: true,

            code,
            username,

            expiresAt:
              new Date(
                room.expires_at
              ).getTime(),

            participants:
              sockets.size,

            messages
          });

          /*
           * Informasikan participant
           * kepada user lain.
           */

          socket
            .to(code)
            .emit(
              "presence",
              {
                participants:
                  sockets.size
              }
            );

          socket
            .to(code)
            .emit(
              "system-message",
              {
                text:
                  `${username} joined the room.`,

                timestamp:
                  Date.now()
              }
            );

        } catch (error) {
          console.error(
            "Join room error:",
            error
          );

          ack?.({
            ok: false,

            error:
              "Failed to join room."
          });
        }
      }
    );

    /*
     * -------------------------------------------------------
     * MESSAGE
     * -------------------------------------------------------
     */

    socket.on(
      "message",
      async (
        {
          text
        },
        ack
      ) => {
        try {
          const now =
            Date.now();

          /*
           * Rate limit.
           */

          const previous =
            messageTimestamps
              .get(
                socket.id
              ) || [];

          const recent =
            previous.filter(
              (timestamp) =>
                now - timestamp <
                MESSAGE_RATE_WINDOW_MS
            );

          if (
            recent.length >=
            MESSAGE_RATE_LIMIT
          ) {
            return ack?.({
              ok: false,

              error:
                "Too many messages. Please slow down."
            });
          }

          recent.push(
            now
          );

          messageTimestamps.set(
            socket.id,
            recent
          );

          const code =
            socket.data.roomCode;

          const username =
            socket.data.username;

          if (
            !code ||
            !username
          ) {
            return ack?.({
              ok: false,

              error:
                "Not in a room."
            });
          }

          /*
           * Sanitasi message.
           */

          const clean =
            String(
              text || ""
            )
              .trim()
              .slice(
                0,
                2000
              );

          if (!clean) {
            return ack?.({
              ok: false,

              error:
                "Empty message."
            });
          }

          /*
           * Pastikan room
           * belum expired.
           */

          const roomResult =
            await pool.query(
              `
              SELECT code

              FROM rooms

              WHERE code = $1
              AND expires_at > NOW()
              `,
              [
                code
              ]
            );

          if (
            roomResult
              .rowCount === 0
          ) {
            return ack?.({
              ok: false,

              error:
                "Room expired."
            });
          }

          const messageId =
            crypto.randomUUID();

          /*
           * Simpan message.
           */

          const messageResult =
            await pool.query(
              `
              INSERT INTO messages (
                id,
                room_code,
                username,
                text
              )

              VALUES (
                $1,
                $2,
                $3,
                $4
              )

              RETURNING
                id,
                username,
                text,

                EXTRACT(
                  EPOCH FROM created_at
                ) * 1000
                  AS timestamp
              `,
              [
                messageId,
                code,
                username,
                clean
              ]
            );

          const row =
            messageResult
              .rows[0];

          const message = {
            id:
              row.id,

            username:
              row.username,

            text:
              row.text,

            timestamp:
              Number(
                row.timestamp
              )
          };

          /*
           * Kirim real-time.
           */

          io
  .to(code)
  .emit(
    "message",
    message
  );

sendPushToRoom(
  code,
  username,
  clean
).catch((error) => {
  console.error(
    "Push notification error:",
    error
  );
});

/*
 * Maksimal 200 pesan
 * tersimpan per room.
 */

          await pool.query(
            `
            DELETE FROM messages

            WHERE room_code = $1

            AND id NOT IN (
              SELECT id

              FROM messages

              WHERE room_code = $1

              ORDER BY
                created_at DESC

              LIMIT 200
            )
            `,
            [
              code
            ]
          );

          ack?.({
            ok: true
          });

        } catch (error) {
          console.error(
            "Message error:",
            error
          );

          ack?.({
            ok: false,

            error:
              "Failed to send message."
          });
        }
      }
    );

    /*
     * -------------------------------------------------------
     * TYPING
     * -------------------------------------------------------
     */

    socket.on(
      "typing",
      (isTyping) => {
        const code =
          socket.data.roomCode;

        if (code) {
          socket
            .to(code)
            .emit(
              "typing",
              {
                username:
                  socket.data
                    .username,

                isTyping:
                  !!isTyping
              }
            );
        }
      }
    );

    /*
     * -------------------------------------------------------
     * LEAVE ROOM
     * -------------------------------------------------------
     */

    socket.on(
      "leave-room",
      () => {
        const code =
          socket.data.roomCode;

        const username =
          socket.data.username;

        if (!code) {
          return;
        }

        const sockets =
          roomSockets.get(
            code
          );

        if (sockets) {
          sockets.delete(
            socket.id
          );

          socket
            .to(code)
            .emit(
              "presence",
              {
                participants:
                  sockets.size
              }
            );

          socket
            .to(code)
            .emit(
              "system-message",
              {
                text:
                  `${username || "Guest"} left the room.`,

                timestamp:
                  Date.now()
              }
            );

          /*
           * Jangan biarkan
           * Set kosong di memory.
           */

          if (
            sockets.size === 0
          ) {
            roomSockets.delete(
              code
            );
          }
        }

        socket.leave(
          code
        );

        socket.data.roomCode =
          null;

        socket.data.username =
          null;

        messageTimestamps
          .delete(
            socket.id
          );
      }
    );

    /*
     * -------------------------------------------------------
     * DISCONNECT
     * -------------------------------------------------------
     */

    socket.on(
      "disconnect",
      () => {
        messageTimestamps
          .delete(
            socket.id
          );

        const code =
          socket.data.roomCode;

        if (!code) {
          return;
        }

        const sockets =
          roomSockets.get(
            code
          );

        if (sockets) {
          sockets.delete(
            socket.id
          );

          socket
            .to(code)
            .emit(
              "presence",
              {
                participants:
                  sockets.size
              }
            );

          if (
            sockets.size === 0
          ) {
            roomSockets.delete(
              code
            );
          }
        }

        socket.data.roomCode =
          null;

        socket.data.username =
          null;
      }
    );
  }
);

/*
 * =========================================================
 * FRONTEND FALLBACK
 * =========================================================
 */

app.use(
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/*
 * =========================================================
 * START SERVER
 * =========================================================
 */

async function startServer() {
  try {
    await initializeDatabase();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `CodeConnect running on port ${PORT}`
        );
      }
    );

  } catch (error) {
    console.error(
      "Failed to start CodeConnect:",
      error
    );

    process.exit(1);
  }
}

startServer();
