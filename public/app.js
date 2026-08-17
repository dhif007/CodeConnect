let socket = null;

let currentCode = null;
let currentName = null;
let pendingCreated = null;

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
 * MOBILE / IPHONE VIEWPORT
 * =========================================================
 */

function updateAppHeight() {
  document.documentElement.style.setProperty(
    "--app-height",
    `${window.innerHeight}px`
  );
}

window.addEventListener(
  "resize",
  updateAppHeight
);

window.addEventListener(
  "orientationchange",
  updateAppHeight
);

/*
 * =========================================================
 * SESSION STORAGE
 * =========================================================
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

function clearSession() {
  sessionStorage.removeItem(
    "codeconnect_code"
  );

  sessionStorage.removeItem(
    "codeconnect_name"
  );
}

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
 * CLEAN INVITE URL
 * =========================================================
 */

function cleanInviteUrl() {
  const cleanUrl =
    `${location.origin}${location.pathname}`;

  window.history.replaceState(
    {},
    document.title,
    cleanUrl
  );
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

  /*
   * Saat chat aktif,
   * navbar utama disembunyikan lewat CSS.
   */
  document.body.classList.toggle(
    "chat-mode",
    id === "chat"
  );

  window.scrollTo(0, 0);

  requestAnimationFrame(() => {
    updateAppHeight();
    window.scrollTo(0, 0);
  });
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

  window.__toast =
    setTimeout(() => {
      element.classList.remove("show");
    }, 2200);
}

/*
 * =========================================================
 * ROOM CODE FORMAT
 * =========================================================
 */

function formatCode(el) {
  let value =
    String(el.value || "")
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
 * PARTICIPANTS
 * =========================================================
 */

function updatePeople(number) {
  const people = $("people");

  if (people) {
    people.textContent =
      number ?? 0;
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

  const messages =
    $("messages");

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
  bubble.textContent =
    message.text;

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

function addSystem(text) {
  const messages =
    $("messages");

  if (!messages) {
    return;
  }

  const element =
    document.createElement("div");

  element.className =
    "system";

  element.textContent =
    text;

  messages.appendChild(
    element
  );

  messages.scrollTop =
    messages.scrollHeight;
}

/*
 * =========================================================
 * ACTIVE ROOM
 * =========================================================
 */

function getActiveRoom() {
  if (
    currentCode &&
    currentName
  ) {
    return {
      code: currentCode,
      name: currentName,
      type: "chat"
    };
  }

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

function applyJoinResult(
  room,
  result
) {
  updatePeople(
    result.participants || 0
  );

  if (
    room.type === "chat"
  ) {
    const chatCode =
      $("chatCode");

    const messages =
      $("messages");

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

  if (
    room.type === "created"
  ) {
    const waitStatus =
      $("waitStatus");

    if (!waitStatus) {
      return;
    }

    waitStatus.textContent =
      result.participants > 1
        ? "🟢 Someone joined — you're connected!"
        : "🟡 Waiting for someone to join...";
  }
}

/*
 * =========================================================
 * ROOM UNAVAILABLE
 * =========================================================
 */

function handleRoomUnavailable(
  error
) {
  clearSession();

  currentCode = null;
  currentName = null;
  pendingCreated = null;
  joinedSocketId = null;

  const typing =
    $("typing");

  if (typing) {
    typing.textContent = "";
  }

  showHome();

  toast(
    error ||
    "Room not found or expired."
  );
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
   * Jangan join ulang
   * menggunakan socket.id yang sama.
   */
  if (
    joinedSocketId ===
    socket.id
  ) {
    if (
      typeof onSuccess ===
      "function"
    ) {
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
      if (
        !res ||
        !res.ok
      ) {
        const error =
          res?.error ||
          "Failed to join room.";

        const lower =
          error.toLowerCase();

        if (
          lower.includes("not found") ||
          lower.includes("expired")
        ) {
          handleRoomUnavailable(
            error
          );

          return;
        }

        if (
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
 * REJOIN
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

  socket.on(
    "connect",
    () => {
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

      joinedSocketId = null;

      rejoinActiveRoom();
    }
  );

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

  socket.on(
    "message",
    addMessage
  );

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

  socket.on(
    "presence",
    ({
      participants
    }) => {
      updatePeople(
        participants
      );

      if (
        pendingCreated
      ) {
        const waitStatus =
          $("waitStatus");

        if (waitStatus) {
          waitStatus.textContent =
            participants > 1
              ? "🟢 Someone joined — you're connected!"
              : "🟡 Waiting for someone to join...";
        }
      }
    }
  );

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
  const createName =
    $("createName");

  const createError =
    $("createError");

  const name =
    createName
      ? createName.value.trim()
      : "";

  if (createError) {
    createError.textContent = "";
  }

  if (!name) {
    if (createError) {
      createError.textContent =
        "Please enter your name.";
    }

    return;
  }

  /*
   * Tutup keyboard iPhone
   * sebelum pindah halaman.
   */
  createName?.blur();

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
      if (createError) {
        createError.textContent =
          data.error ||
          "Could not create the room.";
      }

      return;
    }

    if (!data.code) {
      if (createError) {
        createError.textContent =
          "Could not create the room.";
      }

      return;
    }

    clearSession();

    currentCode = null;
    currentName = null;
    joinedSocketId = null;

    pendingCreated = {
      code: data.code,
      name
    };

    const createdCode =
      $("createdCode");

    const waitStatus =
      $("waitStatus");

    if (createdCode) {
      createdCode.textContent =
        data.code;
    }

    if (waitStatus) {
      waitStatus.textContent =
        "🟡 Waiting for someone to join...";
    }

    generateRoomQR(
      data.code
    );

    show("created");

    connectSocket();

    if (
      socket &&
      socket.connected
    ) {
      rejoinActiveRoom();
    }

  } catch (error) {
    console.error(
      "Create room error:",
      error
    );

    if (createError) {
      createError.textContent =
        "Could not create the room.";
    }
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

  saveSession();

  cleanInviteUrl();

  const chatCode =
    $("chatCode");

  if (chatCode) {
    chatCode.textContent =
      currentCode;
  }

  show("chat");

  /*
   * Jangan join ulang.
   * Creator sudah join room
   * ketika room dibuat.
   */

  const input =
    $("messageInput");

  requestAnimationFrame(() => {
    input?.focus({
      preventScroll: true
    });

    updateAppHeight();
  });
}

/*
 * =========================================================
 * JOIN ROOM
 * =========================================================
 */

function joinRoom() {
  const joinName =
    $("joinName");

  const joinCode =
    $("joinCode");

  const joinError =
    $("joinError");

  const name =
    joinName
      ? joinName.value.trim()
      : "";

  const code =
    joinCode
      ? joinCode.value
          .trim()
          .toUpperCase()
      : "";

  if (joinError) {
    joinError.textContent = "";
  }

  if (!name) {
    if (joinError) {
      joinError.textContent =
        "Please enter your name.";
    }

    return;
  }

  if (
    code.length !== 11
  ) {
    if (joinError) {
      joinError.textContent =
        "Enter a valid XXX-XXX-XXX code.";
    }

    return;
  }

  joinName?.blur();
  joinCode?.blur();

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

  const successfulJoin =
    () => {
      saveSession();

      cleanInviteUrl();

      const chatCode =
        $("chatCode");

      if (chatCode) {
        chatCode.textContent =
          code;
      }

      show("chat");

      const input =
        $("messageInput");

      requestAnimationFrame(() => {
        input?.focus({
          preventScroll: true
        });

        updateAppHeight();
      });
    };

  const failedJoin =
    (error) => {
      clearSession();

      currentCode = null;
      currentName = null;
      joinedSocketId = null;

      if (joinError) {
        joinError.textContent =
          error;
      }
    };

  if (
    socket &&
    socket.connected
  ) {
    joinSocketRoom(
      room,
      successfulJoin,
      failedJoin
    );

    return;
  }

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

      if (
        attempts >= 200
      ) {
        clearInterval(
          waitForJoin
        );

        currentCode = null;
        currentName = null;

        if (joinError) {
          joinError.textContent =
            "Connection timeout. Please try again.";
        }
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

  if (!input) {
    return;
  }

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
      if (
        !res ||
        !res.ok
      ) {
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

let typingTimer = null;

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
  clearSession();

  cleanInviteUrl();

  clearTimeout(
    typingTimer
  );

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

  currentCode = null;
  currentName = null;
  pendingCreated = null;
  joinedSocketId = null;

  const typing =
    $("typing");

  if (typing) {
    typing.textContent = "";
  }

  showHome();
}

/*
 * =========================================================
 * COPY CODE
 * =========================================================
 */

async function copyCode() {
  const code =
    $("createdCode")
      ?.textContent;

  if (!code) {
    return;
  }

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
      ?.textContent;

  if (!code) {
    return;
  }

  const url =
    `${location.origin}/?join=${
      encodeURIComponent(code)
    }`;

  try {
    if (
      navigator.share
    ) {
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
 * RESTORE SESSION
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
      cleanInviteUrl();

      show("chat");

      toast(
        "Room restored."
      );
    };

  const restoreFailure =
    (error) => {
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

  if (
    socket &&
    socket.connected
  ) {
    joinSocketRoom(
      room,
      restoreSuccess,
      restoreFailure
    );

    return;
  }

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

      if (
        attempts >= 200
      ) {
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
    updateAppHeight();
    updateNotificationButton();

    const params =
      new URLSearchParams(
        location.search
      );

    const inviteCode =
      params.get("join");

    if (inviteCode) {
      const existingSession =
        loadSession();

      if (
        existingSession &&
        existingSession.code ===
          inviteCode.toUpperCase()
      ) {
        cleanInviteUrl();

        restoreSession();

        return;
      }

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

    restoreSession();
  }
);
/*
 * =========================================================
 * NOTIFICATION PERMISSION
 * =========================================================
 */

function updateNotificationButton() {
  const button =
    $("notificationButton");

  if (!button) {
    return;
  }

  if (
    !("Notification" in window)
  ) {
    button.textContent =
      "🔕 Unsupported";

    button.disabled = true;

    return;
  }

  if (
    Notification.permission ===
    "granted"
  ) {
    button.textContent =
      "🔔 Enabled";

    button.disabled = true;

    return;
  }

  if (
    Notification.permission ===
    "denied"
  ) {
    button.textContent =
      "🔕 Blocked";

    button.disabled = true;

    return;
  }

  button.textContent =
    "🔔 Enable";

  button.disabled = false;
}

async function enableNotifications() {
  if (
    !("Notification" in window)
  ) {
    toast(
      "Notifications are not supported on this device."
    );

    return;
  }

  try {
    const permission =
      await Notification
        .requestPermission();

    if (
      permission !== "granted"
    ) {
      updateNotificationButton();

      if (
        permission === "denied"
      ) {
        toast(
          "Notifications were blocked."
        );
      } else {
        toast(
          "Notification permission was not granted."
        );
      }

      return;
    }

    await subscribeToPush();

    updateNotificationButton();

    toast(
      "Notifications enabled."
    );

  } catch (error) {
    console.error(
      "Enable notifications error:",
      error
    );

    toast(
      error.message ||
      "Could not enable notifications."
    );
  }
}
/*
 * =========================================================
 * PUSH SUBSCRIPTION
 * =========================================================
 */

function urlBase64ToUint8Array(base64String) {
  const padding =
    "=".repeat(
      (4 - (base64String.length % 4)) % 4
    );

  const base64 =
    (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const rawData =
    window.atob(base64);

  const outputArray =
    new Uint8Array(rawData.length);

  for (
    let i = 0;
    i < rawData.length;
    i++
  ) {
    outputArray[i] =
      rawData.charCodeAt(i);
  }

  return outputArray;
}

async function subscribeToPush() {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    throw new Error(
      "Push notifications are not supported."
    );
  }

  const registration =
    await navigator.serviceWorker.ready;

  const keyResponse =
    await fetch(
      "/api/push/public-key",
      {
        cache: "no-store"
      }
    );

  if (!keyResponse.ok) {
    throw new Error(
      "Could not load push public key."
    );
  }

  const keyData =
    await keyResponse.json();

  if (!keyData.publicKey) {
    throw new Error(
      "Push public key is missing."
    );
  }

  let subscription =
    await registration
      .pushManager
      .getSubscription();

  if (!subscription) {
    subscription =
      await registration
        .pushManager
        .subscribe({
          userVisibleOnly: true,
          applicationServerKey:
            urlBase64ToUint8Array(
              keyData.publicKey
            )
        });
  }

  if (
    !currentCode ||
    !currentName
  ) {
    throw new Error(
      "Join a room before enabling notifications."
    );
  }

  const response =
    await fetch(
      "/api/push/subscribe",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            subscription:
              subscription.toJSON(),

            roomCode:
              currentCode,

            username:
              currentName
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      "Could not save push subscription."
    );
  }

  return subscription;
}
/*
 * =========================================================
 * PWA SERVICE WORKER
 * =========================================================
 */

if (
  "serviceWorker" in navigator
) {
  window.addEventListener(
    "load",
    async () => {
      try {
        await navigator.serviceWorker
          .register("/sw.js");

        console.log(
          "CodeConnect service worker registered."
        );

      } catch (error) {
        console.error(
          "Service worker registration failed:",
          error
        );
      }
    }
  );
}
