# Robbery Bob — Deploy to Cloudflare

## 3 steps, takes 2 minutes

1. Go to **https://workers.cloudflare.com**
   - Sign up free (or log in)
   - Click **"Create application"** → **"Create Worker"**

2. **Delete** all the default code in the editor
   - **Paste** the entire contents of `worker.js`
   - Click **"Save and Deploy"**

3. **Done!** Cloudflare gives you a URL like:
   `https://robbery-bob.YOUR-NAME.workers.dev`

Share that URL — multiplayer works instantly, no extra setup.

## How multiplayer works
- Host clicks 🌐 MULTIPLAYER → Generate Room Code → gets a 4-letter code
- Host sends code to friend (WhatsApp, etc.)
- Friend opens same URL → MULTIPLAYER → types code → JOIN
- The Worker relays the WebRTC handshake (tiny SDP strings)
- Once connected, all game data is direct peer-to-peer — zero server load