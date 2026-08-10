# CodeConnect

A minimal real-time private chat app using room codes.

## Requirements
- Node.js 18+ recommended
- npm

## Run locally

```bash
npm install
npm start
```

Open:

http://localhost:3000

Test real-time chat:
1. Open the site in two browser windows/devices on the same network.
2. Device A creates a room.
3. Device B joins using the code.
4. Send messages from either side.

## Important
This starter implements the core real-time room/chat functionality and a frontend Premium/pricing UI.

The Premium checkout is intentionally a scaffold. For production payments, connect a payment gateway and verify transactions server-side using webhooks. Do not trust client-side Premium flags.

For internet deployment, use HTTPS/WSS and a production database. The current room store is in-memory, so rooms reset when the server restarts.

## Project structure

- `server.js` — Express + Socket.IO server
- `public/index.html` — UI
- `public/style.css` — styling
- `public/app.js` — client logic
- `package.json` — dependencies
