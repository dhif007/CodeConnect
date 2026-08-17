let socket = null;

let currentCode = null;
let currentName = null;
let pendingCreated = null;

/*
 * Menyimpan socket.id yang sudah berhasil join.
 * Socket.IO bisa mendapatkan socket.id baru setelah reconnect.
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
 * SESSION STORAGE
 * =========================================================
 */

/*
 * Simpan room yang sedang digunakan.
 * Ini memungkinkan user kembali ke room setelah refresh.
 */
function saveSession() {
  if (!currentCode || !currentName) {
    return;
  }

  sessionStorage.setItem(
    "codeconnect_code",
    currentCode
  );

  sessionStorage.setItem(
    "codeconnect_name",
    currentName
  );
}

/*
 * Hapus session ketika user benar-benar Leave.
 */
function clearSession() {
  sessionStorage.removeItem(
    "codeconnect_code"
  );

  sessionStorage.removeItem(
    "codeconnect_name"
  );
}

/*
 * Ambil session yang tersimpan.
 */
function loadSession() {
  const code =
    sessionStorage.getItem(
      "codeconnect_code"
    );

  const name =
    sessionStorage.getItem(
      "codeconnect_name"
    );

  if (!code || !name) {
    return null;
  }

  return {
    code,
    name
  };
}

/*
 * =========================================================
 * VIEW
 * =========================================================
 */

function show(id) {
  views.forEach((view) => {
    const element = $(view);

    if (element) {
      element.classList.toggle(
        "active",
        view === id
      );
    }
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

  if (!element) {
    return;
  }

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
  let value = String(el.value || "")
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
    console.error(
      "QR image element not found."
    );
    return;
  }

  img.src =
    `/api/qr/${encodeURIComponent(code)}`;

  img.alt =
    `QR code for room ${code}`;
}

/*
 * =========================================================
 * ACTIVE ROOM
 * =========================================================
 */

function getActiveRoom() {
  /*
   * User sudah berada di room/chat.
   */
  if (currentCode && currentName) {
    return {
      code: currentCode,
      name: currentName,
      type: "chat"
    };
  }

  /*
   * Creator masih berada di halaman
   * ROOM READY.
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
 * PARTICIPANTS
 * =========================================================
 */

function updatePeople(number) {
  const people = $("people");

  if (people) {
    people.textContent = number;
  }
}

/*
 * =========================================================
 * MESSAGE DISPLAY
 * =========================================================
 */

function addMessage(message) {
  if (
    !message ||
    typeof message.text !== "string"
  ) {
    return;
  }

  const messages = $("messages");

  if (!messages) {
    return;
  }

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
  bubble.textContent = message.text;

  const meta =
    document.createElement("div");

  meta.className = "meta";

  const timestamp =
    Number(message.timestamp) ||
    Date.now();

  meta.textContent =
    `${message.username || "Guest"} · ${
      new Date(timestamp)
        .toLocaleTimeString(
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

  messages.appendChild(wrap);

  messages.scrollTop =
    messages.scrollHeight;
}

/*
 * =========================================================
 * SYSTEM MESSAGE
 * =========================================================
 */

function addSystem(text) {
  const messages = $("messages");

  if (!messages) {
    return;
  }

  const element =
    document.createElement("div");

  element.className = "system";
  element.textContent = text;

  messages.appendChild(element);

  messages.scrollTop =
    messages.scrollHeight;
}

/*
 * =========================================================
 * APPLY JOIN RESULT
 * =========================================================
 */

function applyJoinResult(room, result) {
  updatePeople(
    result.participants || 0
  );

  /*
   * Kalau user berada di chat,
   * sinkronkan history dari PostgreSQL.
   */
  if (room.type === "chat") {
    const chatCode = $("chatCode");
    const messages = $("messages");

    if (chatCode) {
      chatCode.textContent =
        room.code;
    }

    if (messages) {
      messages.innerHTML = "";
    }

    (result.messages || [])
      .forEach(addMessage);
  }

  /*
   * Creator masih berada di ROOM READY.
   */
  if (room.type === "created") {
    const waitStatus =
      $("waitStatus");

    if (waitStatus) {
      if (result.participants > 1) {
        waitStatus.textContent =
          "🟢 Someone joined — you're connected!";
      } else {
        waitStatus.textContent =
          "🟡 Waiting for someone to join...";
      }
    }
  }
}

/*
 * =========================================================
 * HANDLE INVALID / EXPIRED ROOM
 * =========================================================
 */

function handleRoomUnavailable(error) {
  const message =
    error ||
    "Room not found or expired.";

  /*
   * Session lama tidak boleh terus
   * mencoba masuk ke room invalid.
   */
  clearSession();

  currentCode = null;
  currentName = null;
  pendingCreated = null;
  joinedSocketId = null;

  const typing = $("typing");

  if (typing) {
    typing.textContent = "";
  }

  showHome();

  toast(message);
}

/*
 * =========================================================
 * JOIN SOCKET ROOM
 * =========================================================
 */

function joinSocketRoom(
  room,
  onSuccess = null,
  onFailure = null
) {
  if (
    !socket ||
    !socket.connected ||
    !room
  ) {
    return;
  }

  /*
   * Socket yang sama tidak perlu join
   * room yang sama berkali-kali.
   */
  if (joinedSocketId === socket.id) {
    if (typeof onSuccess === "function") {
      onSuccess();
    }

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
          res?.error ||
          "Failed to join room.";

        if (
          error
            .toLowerCase()
            .includes("not found") ||
          error
            .toLowerCase()
            .includes("expired")
        ) {
          handleRoomUnavailable(
            error
          );
        } else if (
          typeof onFailure ===
          "function"
        ) {
          onFailure(error);
        } else {
          toast(error);
        }

        return;
      }

      joinedSocketId =
        socket.id;

      applyJoinResult(
        room,
        res
      );

      if (
        typeof onSuccess ===
        "function"
      ) {
        onSuccess(res);
      }
    }
  );
}

/*
 * =========================================================
 * REJOIN ACTIVE ROOM
 * =========================================================
 */

function rejoinActiveRoom() {
  const room =
    getActiveRoom();

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
   * Socket hanya dibuat satu kali.
   */
  if (socket) {
    if (!socket.connected) {
      socket.connect();
    }

    return;
  }

  socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  /*
   * CONNECT / RECONNECT
   */
  socket.on("connect", () => {
    const connDot =
      $("connDot");

    const connText =
      $("connText");

    if (connDot) {
      connDot.style.color =
        "#65e6a4";
    }

    if (connText) {
      connText.textContent =
        "Connected";
    }

    /*
     * socket.id dapat berubah setelah reconnect.
     */
    joinedSocketId = null;

    rejoinActiveRoom();
  });

  /*
   * DISCONNECTED
   */
  socket.on(
    "disconnect",
    () => {
      const connDot =
        $("connDot");

      const connText =
        $("connText");

      if (connDot) {
        connDot.style.color =
          "#ff6b7a";
      }

      if (connText) {
        connText.textContent =
          "Reconnecting...";
      }

      joinedSocketId = null;
    }
  );

  /*
   * RECONNECT ATTEMPT
   */
  socket.io.on(
    "reconnect_attempt",
    () => {
      const connText =
        $("connText");

      if (connText) {
        connText.textContent =
          "Reconnecting...";
      }
    }
  );

  /*
   * RECONNECT ERROR
   */
  socket.io.on(
    "reconnect_error",
    () => {
      const connText =
        $("connText");

      if (connText) {
        connText.textContent =
          "Connection problem";
      }
    }
  );

  /*
   * MESSAGE
   */
  socket.on(
    "message",
    addMessage
  );

  /*
   * SYSTEM MESSAGE
   */
  socket.on(
    "system-message",
    (message) => {
      if (message?.text) {
        addSystem(
          message.text
        );
      }
    }
  );

  /*
   * PARTICIPANT PRESENCE
   */
  socket.on(
    "presence",
    ({ participants }) => {
      updatePeople(
        participants
      );

      if (pendingCreated) {
        const waitStatus =
          $("waitStatus");

        if (waitStatus) {
          if (participants > 1) {
            waitStatus.textContent =
              "🟢 Someone joined — you're connected!";
          } else {
            waitStatus.textContent =
              "🟡 Waiting for someone to join...";
          }
        }
      }
    }
  );

  /*
   * TYPING
   */
  socket.on(
    "typing",
    ({
      username,
      isTyping
    }) => {
      const typing =
        $("typing");

      if (!typing) {
        return;
      }

      typing.textContent =
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
    $("createName")
      .value
      .trim();

  $("createError").textContent =
    "";

  if (!name) {
    $("createError").textContent =
      "Please enter your name.";

    return;
  }

  try {
    const response =
      await fetch(
        "/api/rooms",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({})
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

    /*
     * Bersihkan session room sebelumnya.
     */
    clearSession();

    currentCode = null;
    currentName = null;
    joinedSocketId = null;

    pendingCreated = {
      code: data.code,
      name
    };

    $("createdCode").textContent =
      data.code;

    $("waitStatus").textContent =
      "🟡 Waiting for someone to join...";

    generateRoomQR(
      data.code
    );

    show("created");

    connectSocket();

    /*
     * Kalau socket memang sudah connected,
     * langsung join room baru.
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

  /*
   * Sekarang creator resmi berada di chat.
   * Simpan session untuk refresh.
   */
  saveSession();

  const chatCode =
    $("chatCode");

  if (chatCode) {
    chatCode.textContent =
      currentCode;
  }

  const messages =
    $("messages");

  if (messages) {
    messages.innerHTML = "";
  }

  show("chat");

  /*
   * Ambil history lagi supaya pesan yang
   * masuk saat creator masih di ROOM READY
   * juga bisa ditampilkan.
   */
  if (
    socket &&
    socket.connected
  ) {
    socket.emit(
      "join-room",
      {
        code: currentCode,
        username: currentName
      },
      (res) => {
        if (
          res &&
          res.ok
        ) {
          applyJoinResult(
            {
              code: currentCode,
              name: currentName,
              type: "chat"
            },
            res
          );
        }
      }
    );
  }
}

/*
 * =========================================================
 * JOIN ROOM
 * =========================================================
 */

function joinRoom() {
  const name =
    $("joinName")
      .value
      .trim();

  const code =
    $("joinCode")
      .value
      .trim()
      .toUpperCase();

  $("joinError").textContent =
    "";

  if (!name) {
    $("joinError").textContent =
      "Please enter your name.";

    return;
  }

  /*
   * Format XXX-XXX-XXX = 11 karakter.
   */
  if (code.length !== 11) {
    $("joinError").textContent =
      "Enter a valid XXX-XXX-XXX code.";

    return;
  }

  /*
   * Jangan simpan session sebelum server
   * memastikan room benar-benar valid.
   */
  const room = {
    code,
    name,
    type: "chat"
  };

  currentCode = code;
  currentName = name;
  pendingCreated = null;
  joinedSocketId = null;

  connectSocket();

  const successfulJoin = () => {
    /*
     * Baru simpan setelah server menerima join.
     */
    saveSession();

    $("chatCode").textContent =
      code;

    show("chat");
  };

  const failedJoin = (error) => {
    /*
     * Join gagal, jangan simpan room invalid.
     */
    clearSession();

    currentCode = null;
    currentName = null;
    joinedSocketId = null;

    $("joinError").textContent =
      error;
  };

  if (socket.connected) {
    joinSocketRoom(
      room,
      successfulJoin,
      failedJoin
    );

    return;
  }

  /*
   * Jika socket masih menghubungkan,
   * event connect akan melakukan join.
   *
   * Kita tunggu sampai join berhasil.
   */
  let attempts = 0;

  const waitForJoin =
    setInterval(() => {
      attempts += 1;

      if (
        socket &&
        socket.connected
      ) {
        clearInterval(
          waitForJoin
        );

        joinSocketRoom(
          room,
          successfulJoin,
          failedJoin
        );

        return;
      }

      if (attempts >= 200) {
        clearInterval(
          waitForJoin
        );

        currentCode = null;
        currentName = null;

        $("joinError").textContent =
          "Connection timeout. Please try again.";
      }
    }, 50);
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

  if (!text) {
    return;
  }

  if (
    !socket ||
    !socket.connected ||
    !joinedSocketId
  ) {
    toast(
      "Connection lost. Reconnecting..."
    );

    return;
  }

  socket.emit(
    "message",
    {
      text
    },
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

const messageInput =
  $("messageInput");

if (messageInput) {
  messageInput.addEventListener(
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

      clearTimeout(
        typingTimer
      );

      typingTimer =
        setTimeout(() => {
          if (
            socket &&
            socket.connected &&
            joinedSocketId
          ) {
            socket.emit(
              "typing",
              false
            );
          }
        }, 800);
    }
  );
}

/*
 * =========================================================
 * LEAVE ROOM
 * =========================================================
 */

function leaveRoom() {
  /*
   * Hapus session terlebih dahulu supaya
   * reconnect tidak otomatis join lagi.
   */
  clearSession();

  currentCode = null;
  currentName = null;
  pendingCreated = null;
  joinedSocketId = null;

  clearTimeout(
    typingTimer
  );

  const typing =
    $("typing");

  if (typing) {
    typing.textContent = "";
  }

  if (
    socket &&
    socket.connected
  ) {
    socket.emit(
      "typing",
      false
    );

    socket.emit(
      "leave-room"
    );
  }

  showHome();
}

/*
 * =========================================================
 * COPY ROOM CODE
 * =========================================================
 */

async function copyCode() {
  const code =
    $("createdCode")
      .textContent;

  try {
    await navigator.clipboard
      .writeText(code);

    toast(
      "Room code copied."
    );
  } catch (error) {
    console.error(
      "Copy failed:",
      error
    );

    toast(
      "Could not copy room code."
    );
  }
}

/*
 * =========================================================
 * SHARE ROOM
 * =========================================================
 */

async function shareRoom() {
  const code =
    $("createdCode")
      .textContent;

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

      return;
    }

    await navigator.clipboard
      .writeText(
        `${code}\n${url}`
      );

    toast(
      "Invite copied."
    );

  } catch (error) {
    /*
     * AbortError biasanya berarti user
     * membatalkan native Share.
     */
    if (
      error?.name !==
      "AbortError"
    ) {
      console.error(
        "Share failed:",
        error
      );
    }
  }
}

/*
 * =========================================================
 * PREMIUM PLACEHOLDER
 * =========================================================
 */

function premiumDemo() {
  const premiumNote =
    $("premiumNote");

  if (premiumNote) {
    premiumNote.textContent =
      "Premium checkout is scaffolded for the next step. Connect a payment gateway to activate real subscriptions.";
  }

  toast(
    "Premium checkout coming next."
  );
}

/*
 * =========================================================
 * RESTORE SESSION AFTER REFRESH
 * =========================================================
 */

function restoreSession() {
  const saved =
    loadSession();

  if (!saved) {
    return;
  }

  currentCode =
    saved.code;

  currentName =
    saved.name;

  pendingCreated = null;
  joinedSocketId = null;

  const chatCode =
    $("chatCode");

  if (chatCode) {
    chatCode.textContent =
      currentCode;
  }

  const room = {
    code: currentCode,
    name: currentName,
    type: "chat"
  };

  connectSocket();

  const restoreSuccess =
    () => {
      show("chat");

      toast(
        "Room restored."
      );
    };

  const restoreFailure =
    (error) => {
      console.error(
        "Restore failed:",
        error
      );

      clearSession();

      currentCode = null;
      currentName = null;
      joinedSocketId = null;

      showHome();

      toast(
        error ||
        "Could not restore room."
      );
    };

  /*
   * Socket mungkin sudah connected.
   */
  if (socket.connected) {
    joinSocketRoom(
      room,
      restoreSuccess,
      restoreFailure
    );

    return;
  }

  /*
   * Tunggu socket terhubung.
   */
  let attempts = 0;

  const waitForSocket =
    setInterval(() => {
      attempts += 1;

      if (
        socket &&
        socket.connected
      ) {
        clearInterval(
          waitForSocket
        );

        joinSocketRoom(
          room,
          restoreSuccess,
          restoreFailure
        );

        return;
      }

      /*
       * Sekitar 10 detik.
       */
      if (attempts >= 200) {
        clearInterval(
          waitForSocket
        );

        restoreFailure(
          "Connection timeout."
        );
      }
    }, 50);
}

/*
 * =========================================================
 * PAGE LOAD
 * =========================================================
 */

window.addEventListener(
  "load",
  () => {
    const params =
      new URLSearchParams(
        location.search
      );

    const inviteCode =
      params.get("join");

    /*
     * Invite link mempunyai prioritas.
     *
     * Contoh:
     * ?join=ABC-DEF-GHJ
     */
    if (inviteCode) {
      /*
       * Jangan otomatis masuk ke room lama
       * ketika user membuka invite baru.
       */
      clearSession();

      currentCode = null;
      currentName = null;
      pendingCreated = null;
      joinedSocketId = null;

      showJoin();

      const joinCode =
        $("joinCode");

      if (joinCode) {
        joinCode.value =
          inviteCode;

        formatCode(
          joinCode
        );
      }

      return;
    }

    /*
     * Tidak ada invite URL.
     * Coba restore room dari session.
     */
    restoreSession();
  }
);
