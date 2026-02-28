# Robbery Bob — King of Sneak

## Deploy to Vercel

1. Create a new folder and put these files in it:
   ```
   robbery-bob.html
   vercel.json
   api/
     signal.js
   ```

2. Push to GitHub (or drag-and-drop to Vercel dashboard)

3. Deploy → Vercel auto-detects the config

4. Share your Vercel URL with a friend → click **🌐 MULTIPLAYER** → Host generates a code → Friend joins!

## How multiplayer works

- **Host** clicks "Generate Room Code" → gets a 4-letter code (e.g. `X7KQ`)
- **Host shares the code** with their friend
- **Friend** enters the code and clicks Join
- The `/api/signal` serverless function relays the WebRTC SDP handshake
- Once connected, all game data flows **peer-to-peer** (WebRTC DataChannel) — no server load

## Controls

| Player | Move | Sneak |
|--------|------|-------|
| P1 | WASD / Arrow Keys | Shift |
| P2 | Remote (their own keyboard) | Shift |