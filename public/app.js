let socket = null;

let currentCode = null;
let currentName = null;

let pendingCreated = null;

/*
 * Menyimpan socket.id yang sudah berhasil join.
 * Socket.IO mendapatkan socket.id baru setelah reconnect.
 */
let joinedSocketId = null;

const $ = (id) => document.getElementById(id);

const views = [
  "home",
  "create",
  "created",
  "join",
  "chat",
  "pricing"
];

/*
 * =========================================================
 * VIEW
 * =========================================================
 */

function show(id) {
  views.forEach((view) => {
    $(view).classList.toggle("active", view === id);
  });

  window.scrollTo(0, 0);
}

function showHome() {
  show("home");
}

function showCreate() {
  show("create");
}

function showJoin() {
  show("join");
}

function showPricing() {
  show("pricing");
}

/*
 * =========================================================
 * TOAST
 * =========================================================
 */

function toast(text) {
  const element = $("toast");

  element.textContent = text;
  element.classList.add("show");

  clearTimeout(window.__toast);

  window.__toast = setTimeout(() => {
    element.classList.remove("show");
  }, 2200);
}

/*
 * =========================================================
 * ROOM CODE FORMAT
 * =========================================================
 */

function formatCode(el) {
  let value = el.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 9);

  el.value =
    value.match(/.{1,3}/g)?.join("-") || "";
}

/*
 * =========================================================
 * QR CODE
 * =========================================================
 */

function generateRoomQR(code) {
  const img = $("qrImage");

  if (!img) {
    console.error("QR image element not found.");
    return;
  }

  img.src =
    `/api/qr/${encodeURIComponent(code)}`;

  img.alt =
    `QR code for room ${code}`;
}

/*
 * =========================================================
 * GET ACTIVE ROOM
 * =========================================================
 */

function getActiveRoom() {
  /*
   * User sudah berada di halaman chat.
   */
  if (currentCode && currentName) {
    return {
      code: currentCode,
      name: currentName,
      type: "chat"
    };
  }

  /*
   * Creator masih berada di halaman ROOM READY.
   */
  if (
    pendingCreated &&
    pendingCreated.code &&
    pendingCreated.name
  ) {
    return {
      code: pendingCreated.code,
      name: pendingCreated.name,
      type: "created"
    };
  }

  return null;
}

/*
 * =========================================================
 * APPLY JOIN RESULT
 * =========================================================
 */

function applyJoinResult(room, result) {
  updatePeople(result.participants);

  /*
   * Jika user sedang berada di chat,
   * sinkronkan kembali histori dari server.
   */
  if (room.type === "chat") {
    $("chatCode").textContent = room.code;

    $("messages").innerHTML = "";

    (result.messages || []).forEach(addMessage);
  }

  /*
   * Creator masih menunggu orang masuk.
   */
  if (
    room.type === "created" &&
    result.participants > 1
  ) {
    $("waitStatus").textContent =
      "🟢 Someone joined — you're connected!";
  }
}

/*
 * =========================================================
 * JOIN SOCKET ROOM
 * =========================================================
 */

function joinSocketRoom(room) {
  if (!socket || !socket.connected) {
    return;
  }

  /*
   * Jangan join dua kali menggunakan socket.id yang sama.
   */
  if (joinedSocketId === socket.id) {
    return;
  }

  socket.emit(
    "join-room",
    {
      code: room.code,
      username: room.name
    },
    (res) => {
      if (!res || !res.ok) {
        const error =
          res?.error || "Failed to join room.";

        /*
         * Kalau join normal dari halaman Join,
         * tampilkan error di form.
         */
        if (room.type === "chat") {
          $("joinError").textContent = error;
        } else {
          toast(error);
        }

        return;
      }

      /*
       * Tandai socket sekarang sudah join.
       */
      joinedSocketId = socket.id;

      applyJoinResult(room, res);
    }
  );
}

/*
 * =========================================================
 * REJOIN AFTER RECONNECT
 * =========================================================
 */

function rejoinActiveRoom() {
  const room = getActiveRoom();

  if (!room) {
    return;
  }

  joinSocketRoom(room);
}

/*
 * =========================================================
 * SOCKET CONNECTION
 * =========================================================
 */

function connectSocket() {
  /*
   * Socket cukup dibuat satu kali.
   * Socket.IO sendiri akan menangani reconnect.
   */
  if (socket) {
    if (!socket.connected) {
      socket.connect();
    }

    return;
  }

  socket = io();

  /*
   * CONNECT / RECONNECT
   */
  socket.on("connect", () => {
    $("connDot").style.color = "#65e6a4";
    $("connText").textContent = "Connected";

    /*
     * socket.id berubah setelah reconnect.
     * Karena itu room harus di-join kembali.
     */
    joinedSocketId = null;

    rejoinActiveRoom();
  });

  /*
   * CONNECTION LOST
   */
  socket.on("disconnect", () => {
    $("connDot").style.color = "#ff6b7a";
    $("connText").textContent = "Reconnecting...";

    joinedSocketId = null;
  });

  /*
   * Reconnect sedang dicoba.
   */
  socket.io.on("reconnect_attempt", () => {
    $("connText").textContent = "Reconnecting...";
  });

  /*
   * Reconnect gagal.
   */
  socket.io.on("reconnect_error", () => {
    $("connText").textContent =
      "Connection problem";
  });

  /*
   * MESSAGE
   */
  socket.on("message", addMessage);

  /*
   * SYSTEM MESSAGE
   */
  socket.on("system-message", (message) => {
    addSystem(message.text);
  });

  /*
   * PRESENCE
   */
  socket.on(
    "presence",
    ({ participants }) => {
      updatePeople(participants);

      if (
        pendingCreated &&
        participants > 1
      ) {
        $("waitStatus").textContent =
          "🟢 Someone joined — you're connected!";
      }
    }
  );

  /*
   * TYPING
   */
  socket.on(
    "typing",
    ({ username, isTyping }) => {
      $("typing").textContent =
        isTyping
          ? `${username} is typing...`
          : "";
    }
  );
}

/*
 * =========================================================
 * CREATE ROOM
 * =========================================================
 */

async function createRoom() {
  const name =
    $("createName").value.trim();

  $("createError").textContent = "";

  if (!name) {
    $("createError").textContent =
      "Please enter your name.";
    return;
  }

  try {
    const response = await fetch(
      "/api/rooms",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({})
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      $("createError").textContent =
        data.error ||
        "Could not create the room.";

      return;
    }

    if (!data.code) {
      $("createError").textContent =
        "Could not create the room.";

      return;
    }

    pendingCreated = {
      code: data.code,
      name
    };

    /*
     * Creator belum masuk ke halaman chat,
     * jadi currentCode/currentName belum diisi.
     */
    currentCode = null;
    currentName = null;

    $("createdCode").textContent =
      data.code;

    $("waitStatus").textContent =
      "🟡 Waiting for someone to join...";

    generateRoomQR(data.code);

    show("created");

    connectSocket();

    /*
     * Kalau socket sebelumnya sudah connected,
     * event connect tidak akan dipanggil lagi.
     */
    if (socket.connected) {
      rejoinActiveRoom();
    }

  } catch (error) {
    console.error(
      "Create room error:",
      error
    );

    $("createError").textContent =
      "Could not create the room.";
  }
}

/*
 * =========================================================
 * ENTER CREATED CHAT
 * =========================================================
 */

function enterCreatedChat() {
  if (!pendingCreated) {
    return;
  }

  currentCode =
    pendingCreated.code;

  currentName =
    pendingCreated.name;

  $("chatCode").textContent =
    currentCode;

  $("messages").innerHTML = "";

  show("chat");
}

/*
 * =========================================================
 * JOIN ROOM
 * =========================================================
 */

function joinRoom() {
  const name =
    $("joinName").value.trim();

  const code =
    $("joinCode")
      .value
      .trim()
      .toUpperCase();

  $("joinError").textContent = "";

  if (!name) {
    $("joinError").textContent =
      "Please enter your name.";
    return;
  }

  if (code.length !== 11) {
    $("joinError").textContent =
      "Enter a valid XXX-XXX-XXX code.";
    return;
  }

  currentCode = code;
  currentName = name;

  /*
   * User ini bukan creator yang sedang
   * berada di halaman ROOM READY.
   */
  pendingCreated = null;

  connectSocket();

  const room = {
    code,
    name,
    type: "chat"
  };

  /*
   * Kalau socket sudah tersambung,
   * join langsung.
   *
   * Kalau belum, event "connect"
   * akan menjalankan rejoinActiveRoom().
   */
  if (socket.connected) {
    joinSocketRoom(room);
  }

  /*
   * Kita tunggu callback join berhasil
   * sebelum berpindah halaman.
   */

  const waitForJoin = setInterval(() => {
    if (
      socket &&
      socket.connected &&
      joinedSocketId === socket.id
    ) {
      clearInterval(waitForJoin);

      $("chatCode").textContent =
        code;

      show("chat");
    }
  }, 50);

  /*
   * Jangan biarkan interval berjalan selamanya.
   */
  setTimeout(() => {
    clearInterval(waitForJoin);
  }, 10000);
}

/*
 * =========================================================
 * PARTICIPANTS
 * =========================================================
 */

function updatePeople(n) {
  $("people").textContent = n;
}

/*
 * =========================================================
 * MESSAGE DISPLAY
 * =========================================================
 */

function addMessage(message) {
  const wrap =
    document.createElement("div");

  wrap.className =
    "msg" +
    (
      message.username === currentName
        ? " mine"
        : ""
    );

  const bubble =
    document.createElement("div");

  bubble.className = "bubble";
  bubble.textContent =
    message.text;

  const meta =
    document.createElement("div");

  meta.className = "meta";

  meta.textContent =
    `${message.username} · ${
      new Date(
        message.timestamp
      ).toLocaleTimeString(
        [],
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      )
    }`;

  wrap.append(
    bubble,
    meta
  );

  $("messages").appendChild(wrap);

  $("messages").scrollTop =
    $("messages").scrollHeight;
}

/*
 * =========================================================
 * SYSTEM MESSAGE
 * =========================================================
 */

function addSystem(text) {
  const element =
    document.createElement("div");

  element.className = "system";
  element.textContent = text;

  $("messages").appendChild(element);

  $("messages").scrollTop =
    $("messages").scrollHeight;
}

/*
 * =========================================================
 * SEND MESSAGE
 * =========================================================
 */

function sendMessage(event) {
  event.preventDefault();

  const input =
    $("messageInput");

  const text =
    input.value.trim();

  if (
    !text ||
    !socket ||
    !socket.connected
  ) {
    if (
      text &&
      (!socket || !socket.connected)
    ) {
      toast(
        "Connection lost. Reconnecting..."
      );
    }

    return;
  }

  socket.emit(
    "message",
    { text },
    (res) => {
      if (!res || !res.ok) {
        toast(
          res?.error ||
          "Failed to send message."
        );
      }
    }
  );

  input.value = "";

  socket.emit(
    "typing",
    false
  );

  input.focus();
}

/*
 * =========================================================
 * TYPING
 * =========================================================
 */

let typingTimer;

$("messageInput").addEventListener(
  "input",
  () => {
    if (
      !socket ||
      !socket.connected ||
      !joinedSocketId
    ) {
      return;
    }

    socket.emit(
      "typing",
      true
    );

    clearTimeout(typingTimer);

    typingTimer =
      setTimeout(() => {
        if (
          socket &&
          socket.connected
        ) {
          socket.emit(
            "typing",
            false
          );
        }
      }, 800);
  }
);

/*
 * =========================================================
 * LEAVE ROOM
 * =========================================================
 */

function leaveRoom() {
  if (
    socket &&
    socket.connected
  ) {
    socket.emit("leave-room");
  }

  currentCode = null;
  currentName = null;
  pendingCreated = null;
  joinedSocketId = null;

  $("typing").textContent = "";

  showHome();
}

/*
 * =========================================================
 * COPY CODE
 * =========================================================
 */

function copyCode() {
  const code =
    $("createdCode").textContent;

  navigator.clipboard
    ?.writeText(code)
    .then(() => {
      toast("Room code copied.");
    });
}

/*
 * =========================================================
 * SHARE ROOM
 * =========================================================
 */

async function shareRoom() {
  const code =
    $("createdCode").textContent;

  const url =
    `${location.origin}/?join=${
      encodeURIComponent(code)
    }`;

  try {
    if (navigator.share) {
      await navigator.share({
        title:
          "Join my CodeConnect room",
        text:
          `Join my private room: ${code}`,
        url
      });
    } else {
      await navigator.clipboard.writeText(
        `${code}\n${url}`
      );

      toast("Invite copied.");
    }
  } catch (error) {
    /*
     * User menekan cancel pada native share
     * bukan merupakan error aplikasi.
     */
    console.log(
      "Share cancelled:",
      error
    );
  }
}

/*
 * =========================================================
 * PREMIUM PLACEHOLDER
 * =========================================================
 */

function premiumDemo() {
  $("premiumNote").textContent =
    "Premium checkout is scaffolded for the next step. Connect a payment gateway to activate real subscriptions.";

  toast(
    "Premium checkout coming next."
  );
}

/*
 * =========================================================
 * INVITE LINK
 * =========================================================
 */

window.addEventListener(
  "load",
  () => {
    const params =
      new URLSearchParams(
        location.search
      );

    const join =
      params.get("join");

    if (join) {
      showJoin();

      $("joinCode").value =
        join;

      formatCode(
        $("joinCode")
      );
    }
  }
);
