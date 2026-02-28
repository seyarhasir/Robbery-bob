/**
 * Robbery Bob — King of Sneak
 * Single Cloudflare Worker: serves the game + handles WebRTC signaling
 *
 * Deploy steps:
 *   1. Go to https://workers.cloudflare.com → Create Worker
 *   2. Paste this entire file → Save and Deploy
 *   3. Done! Share your *.workers.dev URL
 *
 * Multiplayer: uses this same Worker as a signaling relay.
 * SDP strings are stored in memory with a 5-min TTL.
 * Once WebRTC handshake is done, all game data is peer-to-peer.
 */

// In-memory signal store  { key → { val, expires } }
const store = new Map();

function storeClean() {
    const now = Date.now();
    for (const [k, v] of store) {
        if (now > v.expires) store.delete(k);
    }
}

function cors(r) {
    r.headers.set('Access-Control-Allow-Origin', '*');
    r.headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return r;
}
function j(data, status = 200) {
    return cors(new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json' }
    }));
}

const GAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Robbery Bob — King of Sneak</title>
<!-- No external MP library needed - we use a free public KV relay for signaling -->
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bungee&family=Bungee+Shade&family=Share+Tech+Mono&display=swap');

  :root {
    --night: #0a0a1a;
    --dark: #12122a;
    --purple: #1a1a3e;
    --gold: #f5c518;
    --orange: #ff6b35;
    --red: #e63946;
    --green: #2dc653;
    --blue: #4cc9f0;
    --white: #f0ede8;
    --gray: #888;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--night);
    color: var(--white);
    font-family: 'Share Tech Mono', monospace;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    overflow: hidden;
    user-select: none;
  }

  #screen {
    position: relative;
  }

  /* MENU */
  #menu {
    text-align: center;
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at center, #1a1a3e 0%, #0a0a1a 70%);
    z-index: 100;
  }
  #menu h1 {
    font-family: 'Bungee Shade', cursive;
    font-size: 48px;
    color: var(--gold);
    text-shadow: 4px 4px 0 #8b6f1a, 0 0 40px rgba(245,197,24,0.4);
    line-height: 1;
    animation: pulse 2s infinite;
  }
  #menu .subtitle {
    font-family: 'Bungee', cursive;
    color: var(--orange);
    font-size: 18px;
    margin: 8px 0 40px;
    letter-spacing: 4px;
  }
  #menu .bob-preview {
    font-size: 60px;
    margin: 20px 0;
    animation: bob-idle 1s infinite alternate;
  }
  @keyframes bob-idle {
    from { transform: translateY(0); }
    to { transform: translateY(-8px); }
  }
  @keyframes pulse {
    0%,100% { text-shadow: 4px 4px 0 #8b6f1a, 0 0 20px rgba(245,197,24,0.3); }
    50% { text-shadow: 4px 4px 0 #8b6f1a, 0 0 60px rgba(245,197,24,0.7); }
  }
  .btn {
    background: var(--gold);
    color: var(--night);
    border: none;
    font-family: 'Bungee', cursive;
    font-size: 20px;
    padding: 14px 40px;
    cursor: pointer;
    letter-spacing: 2px;
    clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
    transition: all 0.15s;
    margin: 6px;
  }
  .btn:hover { background: var(--orange); transform: scale(1.05); }
  .controls-info {
    margin-top: 30px;
    color: var(--gray);
    font-size: 13px;
    line-height: 1.8;
  }
  .controls-info span { color: var(--blue); }

  /* HUD */
  #hud {
    position: absolute;
    top: 0; left: 0; right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);
    z-index: 50;
    pointer-events: none;
  }
  #hud .level-info {
    font-family: 'Bungee', cursive;
    color: var(--gold);
    font-size: 16px;
  }
  #hud .loot-info {
    font-size: 14px;
    color: var(--green);
  }
  #hud .alert-meter {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  #hud .alert-label { font-size: 12px; color: var(--gray); }
  #hud .alert-bar {
    width: 100px;
    height: 10px;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 2px;
    overflow: hidden;
  }
  #hud .alert-fill {
    height: 100%;
    background: var(--green);
    transition: width 0.2s, background 0.3s;
    border-radius: 2px;
  }

  /* CANVAS */
  canvas {
    display: block;
    background: #0d0d20;
    image-rendering: pixelated;
  }

  /* OVERLAY messages */
  #overlay {
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.75);
    z-index: 80;
    text-align: center;
  }
  #overlay.show { display: flex; }
  #overlay h2 {
    font-family: 'Bungee Shade', cursive;
    font-size: 52px;
    margin-bottom: 20px;
  }
  #overlay.win h2 { color: var(--gold); }
  #overlay.caught h2 { color: var(--red); }
  #overlay p { color: var(--gray); margin-bottom: 24px; font-size: 15px; }

  /* Mobile controls */
  #mobile-controls {
    display: none;
    position: absolute;
    bottom: 10px;
    left: 0; right: 0;
    justify-content: space-between;
    padding: 0 20px;
    z-index: 60;
  }
  .dpad { display: grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(3, 44px); gap: 3px; }
  .dpad button {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: white;
    font-size: 18px;
    cursor: pointer;
    border-radius: 6px;
    transition: background 0.1s;
  }
  .dpad button:active { background: rgba(255,255,255,0.3); }
  .dpad .center { background: transparent; border: none; cursor: default; }

  @media (pointer: coarse) {
    #mobile-controls { display: flex; }
  }
</style>
</head>
<body>

<div id="screen" style="width:600px;height:520px;position:relative;">

  <!-- MENU -->
  <div id="menu">
    <canvas id="menu-bob" width="60" height="80" style="margin:10px auto;display:block;"></canvas>
    <h1>ROBBERY BOB</h1>
    <div class="subtitle">King of Sneak</div>
    <button class="btn" onclick="startGame(1)">▶ START HEIST</button>
    <button class="btn" onclick="showMultiplayerInfo()" style="background:#4cc9f0;font-size:15px;padding:10px 28px;">🌐 MULTIPLAYER</button>
    <div class="controls-info">
      <span>WASD / Arrow Keys</span> — Move<br>
      <span>Shift</span> — Sneak (harder to detect)<br>
      Avoid guards 🔦 cameras 📷 lasers ⚡<br>
      Gems💎 Laptops💻 Paintings🖼 Crowns♛ = more $$$
    </div>
  </div>

  <!-- HUD -->
  <div id="hud" style="display:none;">
    <div class="level-info" id="level-display">LEVEL 1</div>
    <div class="loot-info">🎯 <span id="loot-count">0/0</span> &nbsp; 💎 <span id="score-display">0</span></div>
    <div class="alert-meter">
      <span class="alert-label">ALERT</span>
      <div class="alert-bar"><div class="alert-fill" id="alert-fill" style="width:0%"></div></div>
    </div>
  </div>

  <!-- GAME CANVAS -->
  <canvas id="canvas" width="600" height="520" tabindex="0" style="outline:none"></canvas>

  <!-- WIN/CAUGHT OVERLAY -->
  <div id="overlay">
    <h2 id="overlay-title">BUSTED!</h2>
    <p id="overlay-msg">The guard caught you sneaking around.</p>
    <button class="btn" id="overlay-btn">TRY AGAIN</button>
  </div>

  <!-- Multiplayer Modal -->
  <div id="mp-modal" style="display:none;position:absolute;inset:0;background:rgba(5,5,20,0.97);z-index:200;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;gap:12px;">
    <h2 style="font-family:'Bungee Shade',cursive;color:#4cc9f0;font-size:34px;">ONLINE CO-OP</h2>
    <p style="color:#888;font-size:12px;max-width:380px;">Uses WebRTC peer-to-peer — no server needed. Both players must have the game open.</p>

    <!-- HOST -->
    <div id="mp-host-section" style="background:rgba(255,255,255,0.04);border:1px solid #4cc9f080;border-radius:8px;padding:16px 24px;width:340px;">
      <div style="font-family:'Bungee',cursive;color:#f5c518;font-size:14px;margin-bottom:10px;">HOST A HEIST</div>
      <button class="btn" id="btn-host" onclick="mpHost()" style="font-size:14px;padding:10px 24px;">Generate Room Code</button>
      <div id="host-code-area" style="display:none;margin-top:12px;">
        <div style="color:#888;font-size:11px;margin-bottom:6px;">Send this code to your partner:</div>
        <div id="host-code" onclick="navigator.clipboard&&navigator.clipboard.writeText(this.textContent).then(()=>{this.style.color='#2dc653';setTimeout(()=>this.style.color='#f5c518',1000)})"
          style="font-family:'Bungee',cursive;font-size:42px;color:#f5c518;letter-spacing:10px;text-shadow:0 0 30px #f5c518bb;cursor:pointer;padding:6px 0;" title="Click to copy"></div>
        <div style="color:#444;font-size:10px;margin-bottom:6px;">Click code to copy</div>
        <div id="host-status" style="color:#888;font-size:12px;margin-top:4px;">Waiting for partner...</div>
      </div>
    </div>

    <!-- JOIN -->
    <div style="background:rgba(255,255,255,0.04);border:1px solid #2dc65380;border-radius:8px;padding:16px 24px;width:340px;">
      <div style="font-family:'Bungee',cursive;color:#2dc653;font-size:14px;margin-bottom:10px;">JOIN A HEIST</div>
      <div style="display:flex;gap:8px;justify-content:center;align-items:center;">
        <input id="join-code-input" maxlength="6" placeholder="ENTER CODE"
          onkeydown="if(event.key==='Enter') mpJoin()"
          oninput="this.value=this.value.toUpperCase()"
          style="background:#0a0a1a;border:1px solid #2dc653;color:#2dc653;font-family:'Bungee',cursive;font-size:20px;padding:8px 12px;width:150px;letter-spacing:4px;text-align:center;border-radius:4px;outline:none;" />
        <button class="btn" onclick="mpJoin()" style="background:#2dc653;font-size:14px;padding:10px 20px;">JOIN</button>
      </div>
      <div id="join-status" style="color:#888;font-size:11px;margin-top:8px;min-height:16px;"></div>
    </div>

    <div style="color:#555;font-size:11px;max-width:340px;">
      P1 uses <span style="color:#4cc9f0">WASD/Arrows</span> · P2 uses <span style="color:#2dc653">IJKL</span><br>
      Both collect loot · First to reach exit triggers level clear
    </div>
    <button class="btn" onclick="mpClose()" style="background:#333;font-size:13px;padding:8px 20px;margin-top:4px;">← BACK</button>
  </div>

  <!-- Mobile D-Pad -->
  <div id="mobile-controls">
    <div class="dpad">
      <div></div>
      <button ontouchstart="keys['ArrowUp']=true" ontouchend="keys['ArrowUp']=false">↑</button>
      <div></div>
      <button ontouchstart="keys['ArrowLeft']=true" ontouchend="keys['ArrowLeft']=false">←</button>
      <div class="center"></div>
      <button ontouchstart="keys['ArrowRight']=true" ontouchend="keys['ArrowRight']=false">→</button>
      <div></div>
      <button ontouchstart="keys['ArrowDown']=true" ontouchend="keys['ArrowDown']=false">↓</button>
      <div></div>
    </div>
  </div>
</div>

<script>
// Animated Bob on menu
(function menuBob(){
  const mc = document.getElementById('menu-bob');
  const mx = mc.getContext('2d');
  function drawMenuBob(){
    mx.clearRect(0,0,60,80);
    mx.save();
    mx.translate(30,46);
    // glow
    mx.shadowColor='#f5c518'; mx.shadowBlur=20;
    mx.fillStyle='rgba(245,197,24,0.1)';
    mx.beginPath(); mx.arc(0,0,18,0,Math.PI*2); mx.fill();
    mx.shadowBlur=0;
    // body
    mx.fillStyle='#1c1c3a'; mx.strokeStyle='#f5c518'; mx.lineWidth=1.5;
    mx.beginPath(); mx.ellipse(0,5,9,11,0,0,Math.PI*2); mx.fill(); mx.stroke();
    // legs
    const la = Math.sin(Date.now()*0.005)*5;
    mx.strokeStyle='#2a2a5a'; mx.lineWidth=4; mx.lineCap='round';
    mx.beginPath(); mx.moveTo(-4,13); mx.lineTo(-4-la*0.5,20); mx.stroke();
    mx.beginPath(); mx.moveTo(4,13); mx.lineTo(4+la*0.5,20); mx.stroke();
    mx.fillStyle='#111';
    mx.beginPath(); mx.ellipse(-4-la*0.5,21,4,2.5,0,0,Math.PI*2); mx.fill();
    mx.beginPath(); mx.ellipse(4+la*0.5,21,4,2.5,0,0,Math.PI*2); mx.fill();
    // arms
    mx.strokeStyle='#1c1c3a'; mx.lineWidth=3.5;
    mx.beginPath(); mx.moveTo(-8,3); mx.lineTo(-13,9+la); mx.stroke();
    mx.beginPath(); mx.moveTo(8,3); mx.lineTo(13,9-la); mx.stroke();
    mx.fillStyle='#f5a97a';
    mx.beginPath(); mx.arc(-13,9+la,3,0,Math.PI*2); mx.fill();
    mx.beginPath(); mx.arc(13,9-la,3,0,Math.PI*2); mx.fill();
    // head
    mx.shadowColor='#f5c518'; mx.shadowBlur=8;
    mx.fillStyle='#f5a97a'; mx.beginPath(); mx.arc(0,-7,9,0,Math.PI*2); mx.fill();
    mx.shadowBlur=0;
    // hat
    mx.fillStyle='#922b21';
    mx.beginPath(); mx.ellipse(0,-13,9,5,0,Math.PI,0); mx.fill();
    mx.fillStyle='#7b241c'; mx.fillRect(-9,-15,18,5);
    mx.fillStyle='#922b21'; mx.fillRect(-10,-11,20,3);
    // eyes
    mx.fillStyle='#1a1a3a';
    mx.beginPath(); mx.arc(-3,-7,2,0,Math.PI*2); mx.fill();
    mx.beginPath(); mx.arc(3,-7,2,0,Math.PI*2); mx.fill();
    mx.fillStyle='#fff';
    mx.beginPath(); mx.arc(-2.3,-7.7,0.8,0,Math.PI*2); mx.fill();
    mx.beginPath(); mx.arc(3.7,-7.7,0.8,0,Math.PI*2); mx.fill();
    // mask
    mx.fillStyle='#7b241c'; mx.fillRect(-7,-4,14,4);
    mx.restore();
    const bobY = Math.sin(Date.now()*0.003)*4;
    mc.style.transform=\`translateY(\${bobY}px)\`;
    requestAnimationFrame(drawMenuBob);
  }
  drawMenuBob();
})();

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = 600, H = 520;
const TILE = 40;
const COLS = Math.floor(W / TILE);
const ROWS = Math.floor(H / TILE);

const keys = {};
document.addEventListener('keydown', e => {
  // Don't capture keys when typing in an input field
  if(document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
  keys[e.key] = true;
});
document.addEventListener('keyup', e => {
  if(document.activeElement && document.activeElement.tagName === 'INPUT') return;
  keys[e.key] = false;
});
// Make sure canvas has focus for key events (but not when an input is active)
document.addEventListener('click', e => {
  if(e.target.tagName !== 'INPUT') canvas.focus();
});

// ===================== LEVELS =====================
const LEVELS = [
  {
    // 1: small house, 1 guard, 3 loot
    walls: [
      // outer walls
      ...range(0,15).map(x=>[x,0]), ...range(0,15).map(x=>[x,12]),
      ...range(0,13).map(y=>[0,y]), ...range(0,13).map(y=>[14,y]),
      // inner rooms
      [4,2],[4,3],[4,4],[4,5],
      [8,2],[8,3],[8,4],
      [2,7],[3,7],[4,7],[5,7],[6,7],
      [10,5],[10,6],[10,7],[10,8],[11,8],[12,8],
    ],
    loot: [[2,2,'bag'],[12,10,'gem']],
    guards: [{ x:6.5*TILE, y:5*TILE, angle:0, patrolPath:[[6,5],[8,5],[8,8],[6,8]], speed:0.7 }],
    exit: [13,11],
    bob: [1,11],
  },
  {
    // 2: bigger, 2 guards
    walls: [
      ...range(0,15).map(x=>[x,0]), ...range(0,15).map(x=>[x,12]),
      ...range(0,13).map(y=>[0,y]), ...range(0,13).map(y=>[14,y]),
      [3,2],[3,3],[3,4],[3,5],[3,6],
      [6,3],[7,3],[8,3],
      [6,7],[7,7],[8,7],[9,7],
      [11,1],[11,2],[11,3],[11,4],
      [5,9],[5,10],[5,11],
      [10,9],[10,10],
    ],
    loot: [[1,2,'bag'],[7,1,'gem'],[12,10,'laptop']],
    guards: [
      { x:5*TILE, y:2*TILE, angle:0, patrolPath:[[5,2],[9,2],[9,5],[5,5]], speed:0.9 },
      { x:2*TILE, y:8*TILE, angle:Math.PI, patrolPath:[[2,8],[4,8],[4,11],[2,11]], speed:0.8 },
    ],
    exit: [13,1],
    bob: [1,11],
  },
  {
    // 3: museum, 3 guards
    walls: [
      ...range(0,15).map(x=>[x,0]), ...range(0,15).map(x=>[x,12]),
      ...range(0,13).map(y=>[0,y]), ...range(0,13).map(y=>[14,y]),
      [2,2],[3,2],[4,2],[5,2],
      [2,5],[3,5],[4,5],
      [7,2],[7,3],[7,4],[7,5],[7,6],
      [9,6],[10,6],[11,6],[12,6],
      [9,3],[10,3],
      [2,8],[3,8],
      [4,9],[4,10],[4,11],
      [9,8],[9,9],[9,10],
      [12,8],[12,9],[12,10],
    ],
    loot: [[1,1,'painting'],[12,1,'gem'],[1,6,'bag'],[12,11,'crown']],
    guards: [
      { x:5*TILE, y:4*TILE, angle:0, patrolPath:[[5,4],[6,4],[6,1],[1,1],[1,4]], speed:1.0 },
      { x:11*TILE, y:4*TILE, angle:Math.PI/2, patrolPath:[[11,1],[13,1],[13,5],[8,5],[8,2]], speed:0.9 },
      { x:7*TILE, y:10*TILE, angle:Math.PI, patrolPath:[[1,10],[6,10],[6,8],[13,8],[13,11],[1,11]], speed:0.8 },
      { type:'camera', x:7*TILE, y:1*TILE, angle:Math.PI/2, sweepRange:1.1, sweepSpeed:0.008, fovDist:TILE*3.5 },
    ],
    exit: [7,11],
    bob: [5,7],
  },
  {
    // 4: Bank vault — 3 horizontal corridor lanes, gaps allow passage between rows
    // Lane 1: rows 1-3, Lane 2: rows 5-7, Lane 3: rows 9-11
    // Gaps in dividers: row4 gap at col4, row8 gap at col10
    // Exit top-right corner [13,1], bob starts bottom-left [1,11]
    walls: [
      ...range(0,15).map(x=>[x,0]), ...range(0,15).map(x=>[x,12]),
      ...range(0,13).map(y=>[0,y]), ...range(0,13).map(y=>[14,y]),
      // divider row 4: gap at cols 4 and 9 to allow vertical travel
      [1,4],[2,4],[3,4],[5,4],[6,4],[7,4],[8,4],[10,4],[11,4],[12,4],[13,4],
      // divider row 8: gap at cols 4 and 9
      [1,8],[2,8],[3,8],[5,8],[6,8],[7,8],[8,8],[10,8],[11,8],[12,8],[13,8],
      // vault boxes in top-right area (decorative, not blocking path)
      [11,1],[11,2],
    ],
    loot: [[2,2,'bag'],[13,2,'gem'],[2,6,'laptop'],[13,6,'bag'],[7,10,'gem'],[7,1,'crown']],
    guards: [
      { x:5*TILE, y:2*TILE, angle:0, patrolPath:[[1,1],[10,1],[10,3],[1,3]], speed:1.2 },
      { x:5*TILE, y:6*TILE, angle:Math.PI, patrolPath:[[13,5],[1,5],[1,7],[13,7]], speed:1.2 },
      { x:5*TILE, y:10*TILE, angle:0, patrolPath:[[1,9],[13,9],[13,11],[1,11]], speed:1.1 },
      { type:'camera', x:13*TILE, y:6*TILE, angle:Math.PI, sweepRange:1.0, sweepSpeed:0.012, fovDist:TILE*3.5 },
      { type:'laser', x1:5*TILE+5, y1:8*TILE+20, x2:9*TILE-5, y2:8*TILE+20 },
    ],
    exit: [13,3],
    bob: [1,11],
  },
  {
    // 5: Art Gallery — open center, guards sweep wide
    walls: [
      ...range(0,15).map(x=>[x,0]), ...range(0,15).map(x=>[x,12]),
      ...range(0,13).map(y=>[0,y]), ...range(0,13).map(y=>[14,y]),
      [3,2],[3,3],[4,3],[4,2],
      [10,2],[10,3],[11,3],[11,2],
      [3,9],[3,10],[4,10],[4,9],
      [10,9],[10,10],[11,10],[11,9],
      [6,4],[7,4],[8,4],
      [6,8],[7,8],[8,8],
      [2,5],[2,6],[2,7],
      [12,5],[12,6],[12,7],
    ],
    loot: [[1,2,'painting'],[12,2,'gem'],[7,6,'crown'],[1,10,'bag'],[12,10,'laptop'],[5,4,'gem'],[9,4,'painting']],
    guards: [
      { x:7*TILE, y:3*TILE, angle:0, patrolPath:[[5,1],[9,1],[13,3],[9,11],[5,11],[1,3]], speed:1.3 },
      { x:3*TILE, y:6*TILE, angle:Math.PI/2, patrolPath:[[1,4],[5,4],[5,8],[1,8]], speed:1.3 },
      { x:11*TILE, y:6*TILE, angle:-Math.PI/2, patrolPath:[[13,4],[9,4],[9,8],[13,8]], speed:1.3 },
      { x:7*TILE, y:9*TILE, angle:Math.PI, patrolPath:[[5,9],[9,9],[9,11],[5,11]], speed:1.2 },
      { type:'camera', x:1*TILE, y:1*TILE, angle:0, sweepRange:1.0, sweepSpeed:0.01, fovDist:TILE*3.5 },
      { type:'camera', x:13*TILE, y:11*TILE, angle:Math.PI, sweepRange:1.0, sweepSpeed:0.013, fovDist:TILE*3.5 },
    ],
    exit: [7,11],
    bob: [7,6],
  },
  {
    // 6: Casino floor — maze-like, 4 guards, lots of loot
    walls: [
      ...range(0,15).map(x=>[x,0]), ...range(0,15).map(x=>[x,12]),
      ...range(0,13).map(y=>[0,y]), ...range(0,13).map(y=>[14,y]),
      [2,2],[3,2],[4,2],
      [6,2],[7,2],
      [9,2],[10,2],[11,2],
      [2,5],[3,5],
      [6,4],[6,5],[6,6],
      [9,5],[10,5],[11,5],
      [2,8],[3,8],[4,8],
      [8,7],[8,8],[8,9],
      [11,8],[12,8],
      [4,10],[5,10],
      [10,10],[11,10],
    ],
    loot: [[1,2,'gem'],[12,2,'crown'],[4,4,'laptop'],[12,4,'gem'],[1,7,'bag'],[12,7,'painting'],[7,10,'crown'],[13,10,'gem']],
    guards: [
      { x:2*TILE, y:1*TILE, angle:0, patrolPath:[[1,1],[5,1],[5,3],[1,3]], speed:1.4 },
      { x:9*TILE, y:1*TILE, angle:0, patrolPath:[[8,1],[13,1],[13,3],[8,3]], speed:1.5 },
      { x:5*TILE, y:7*TILE, angle:Math.PI, patrolPath:[[1,6],[7,6],[7,11],[1,11]], speed:1.5 },
      { x:11*TILE, y:7*TILE, angle:0, patrolPath:[[9,7],[13,7],[13,11],[9,11]], speed:1.5 },
      { type:'camera', x:7*TILE, y:1*TILE, angle:Math.PI/2, sweepRange:1.2, sweepSpeed:0.014, fovDist:TILE*4 },
      { type:'laser', x1:2*TILE+5, y1:7*TILE+20, x2:5*TILE-5, y2:7*TILE+20 },
      { type:'laser', x1:9*TILE+5, y1:7*TILE+20, x2:12*TILE-5, y2:7*TILE+20 },
    ],
    exit: [13,11],
    bob: [1,11],
  },
  {
    // 7: Mansion — 6 rooms separated by 2-wide walls with clear doorways
    // Rooms: TL[1-3,1-4], TC[6-8,1-4], TR[11-13,1-4]
    //        BL[1-3,7-10], BC[6-8,7-10], BR[11-13,7-10]
    // Central corridor row 5-6 connects top/bottom, col 4-5 and 9-10 connect left/right
    walls: [
      ...range(0,15).map(x=>[x,0]), ...range(0,15).map(x=>[x,12]),
      ...range(0,13).map(y=>[0,y]), ...range(0,13).map(y=>[14,y]),
      // vertical dividers — 2 wide, doorway gap in middle
      // left divider col 4-5, gap at rows 3 and 8
      [4,1],[4,2],[5,1],[5,2],
      [4,4],[4,5],[5,4],[5,5],
      [4,7],[4,8],[5,7],[5,8],
      [4,10],[4,11],[5,10],[5,11],
      // right divider col 9-10, gap at rows 3 and 8
      [9,1],[9,2],[10,1],[10,2],
      [9,4],[9,5],[10,4],[10,5],
      [9,7],[9,8],[10,7],[10,8],
      [9,10],[9,11],[10,10],[10,11],
      // horizontal divider row 5-6, gap in center col 7
      [1,5],[2,5],[3,5],
      [1,6],[2,6],[3,6],
      [6,5],[6,6],
      [8,5],[8,6],
      [11,5],[12,5],[13,5],
      [11,6],[12,6],[13,6],
    ],
    loot: [[2,2,'painting'],[7,2,'crown'],[12,2,'gem'],[7,4,'laptop'],[2,8,'bag'],[12,8,'gem'],[7,10,'painting'],[12,10,'crown']],
    guards: [
      { x:2*TILE, y:2*TILE, angle:0, patrolPath:[[1,1],[3,1],[3,4],[1,4]], speed:1.5 },
      { x:7*TILE, y:2*TILE, angle:0, patrolPath:[[6,1],[8,1],[8,4],[6,4]], speed:1.7 },
      { x:12*TILE, y:2*TILE, angle:0, patrolPath:[[11,1],[13,1],[13,4],[11,4]], speed:1.5 },
      { x:2*TILE, y:9*TILE, angle:Math.PI, patrolPath:[[1,7],[3,7],[3,11],[1,11]], speed:1.6 },
      { x:12*TILE, y:9*TILE, angle:Math.PI, patrolPath:[[11,7],[13,7],[13,11],[11,11]], speed:1.6 },
      { type:'camera', x:7*TILE, y:1*TILE, angle:Math.PI/2, sweepRange:1.4, sweepSpeed:0.016, fovDist:TILE*4 },
      { type:'camera', x:7*TILE, y:11*TILE, angle:-Math.PI/2, sweepRange:1.4, sweepSpeed:0.018, fovDist:TILE*4 },
      { type:'laser', x1:1*TILE+5, y1:3*TILE+5, x2:3*TILE-5, y2:3*TILE+5 },
    ],
    exit: [7,11],
    bob: [7,9],
  },
  {
    // 8: Final heist — tight maze, 5 fast guards, max loot
    walls: [
      ...range(0,15).map(x=>[x,0]), ...range(0,15).map(x=>[x,12]),
      ...range(0,13).map(y=>[0,y]), ...range(0,13).map(y=>[14,y]),
      [2,2],[3,2],[4,2],[5,2],[6,2],
      [8,2],[9,2],[10,2],[11,2],[12,2],
      [2,4],[3,4],
      [5,4],[5,5],[5,6],
      [8,4],[9,4],
      [11,4],[12,4],[12,5],[12,6],
      [2,6],[3,6],[4,6],
      [7,5],[7,6],[7,7],
      [9,6],[10,6],
      [2,8],[2,9],[2,10],
      [4,8],[5,8],[6,8],
      [8,8],[9,8],
      [11,8],[11,9],[11,10],
      [4,10],[5,10],[6,10],
      [8,10],[9,10],[10,10],
    ],
    loot: [[7,1,'crown'],[13,2,'painting'],[1,5,'gem'],[13,5,'laptop'],[4,7,'gem'],[8,7,'gem'],[3,9,'crown'],[12,9,'painting'],[1,11,'bag'],[13,11,'gem']],
    guards: [
      { x:4*TILE, y:1*TILE, angle:0, patrolPath:[[1,1],[7,1],[7,3],[1,3]], speed:1.8 },
      { x:11*TILE, y:1*TILE, angle:0, patrolPath:[[8,1],[13,1],[13,3],[8,3]], speed:1.8 },
      { x:1*TILE, y:6*TILE, angle:Math.PI/2, patrolPath:[[1,4],[3,4],[3,7],[1,7]], speed:1.7 },
      { x:13*TILE, y:6*TILE, angle:-Math.PI/2, patrolPath:[[13,4],[11,4],[11,7],[13,7]], speed:1.7 },
      { x:7*TILE, y:10*TILE, angle:Math.PI, patrolPath:[[1,9],[4,9],[4,11],[10,11],[13,9],[13,11]], speed:1.5 },
      { type:'camera', x:7*TILE, y:4*TILE, angle:0, sweepRange:Math.PI*0.9, sweepSpeed:0.02, fovDist:TILE*4.5 },
      { type:'camera', x:7*TILE, y:8*TILE, angle:Math.PI, sweepRange:Math.PI*0.9, sweepSpeed:0.022, fovDist:TILE*4.5 },
      { type:'laser', x1:1*TILE+5, y1:3*TILE+5, x2:6*TILE-5, y2:3*TILE+5 },
      { type:'laser', x1:8*TILE+5, y1:3*TILE+5, x2:13*TILE-5, y2:3*TILE+5 },
    ],
    exit: [7,11],
    bob: [1,9],
  },
];

function range(a,b){ const r=[]; for(let i=a;i<b;i++) r.push(i); return r; }

// ===================== ITEM TYPES =====================
const ITEMS = {
  bag:      { value:100,  color:'#d4a017', glow:'#f5c518', label:'$',  size:11 },
  gem:      { value:300,  color:'#00d4ff', glow:'#00aaff', label:'◆',  size:9  },
  laptop:   { value:500,  color:'#aaaaaa', glow:'#ffffff', label:'⬛',  size:10 },
  painting: { value:800,  color:'#c0392b', glow:'#e74c3c', label:'🖼',  size:12 },
  crown:    { value:2000, color:'#f5c518', glow:'#ffe066', label:'♛',  size:13 },
};

// ===================== GAME STATE =====================
let state, animFrame;

function startGame(level) {
  document.getElementById('menu').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('overlay').className = '';
  document.getElementById('overlay').style.display = 'none';

  const lvl = LEVELS[(level-1) % LEVELS.length];

  // Build wall set
  const wallSet = new Set(lvl.walls.map(([x,y])=>\`\${x},\${y}\`));

  // Init guards
  // FOV distance and angle scale with level — early levels have shorter, narrower cones
  const fovDist  = TILE * (2.5 + level * 0.25);   // L1=2.75, L8=4.5
  const fovAngle = Math.PI * (0.28 + level * 0.02); // L1=0.30, L8=0.44

  const guards = lvl.guards.filter(g=>!g.type).map(g => ({
    x: g.patrolPath[0][0]*TILE + TILE/2,
    y: g.patrolPath[0][1]*TILE + TILE/2,
    angle: g.angle,
    patrolPath: g.patrolPath.map(([px,py])=>({x:px*TILE+TILE/2,y:py*TILE+TILE/2})),
    patrolIdx: 0,
    speed: g.speed,
    fovAngle,
    fovDist,
    alerting: false,
  }));

  const cameras = lvl.guards.filter(g=>g.type==='camera').map(g => ({
    x: g.x, y: g.y,
    baseAngle: g.angle,
    angle: g.angle,
    sweepRange: g.sweepRange,
    sweepSpeed: g.sweepSpeed,
    fovDist: g.fovDist,
    fovAngle: Math.PI * 0.22,
    alerting: false,
    t: Math.random()*Math.PI*2,
  }));

  const lasers = lvl.guards.filter(g=>g.type==='laser').map(g => ({
    x1:g.x1, y1:g.y1, x2:g.x2, y2:g.y2,
    active: true,
    blinkTimer: 0,
  }));

  const prevScore = state ? (state.score||0) : 0;
  state = {
    level,
    walls: wallSet,
    wallList: lvl.walls,
    loot: lvl.loot.map(([x,y,type='bag'])=>({x:x*TILE+TILE/2, y:y*TILE+TILE/2, type, collected:false})),
    guards,
    cameras,
    lasers,
    score: prevScore,
    exit: {x:lvl.exit[0]*TILE+TILE/2, y:lvl.exit[1]*TILE+TILE/2},
    bob: {x:lvl.bob[0]*TILE+TILE/2, y:lvl.bob[1]*TILE+TILE/2, speed:2.2, sneakSpeed:1.3, r:10},
    alert: 0,
    gameOver: false,
    won: false,
    flashTimer: 0,
    sneaking: false,
  };

  updateHUD();
  if(animFrame) cancelAnimationFrame(animFrame);
  last = 0;
  canvas.focus();
  loop();
}

const LEVEL_NAMES = ['The Suburbs','City Lockup','Museum Heist','Bank Vault','Art Gallery','Casino Night','Mansion','Final Heist'];

function updateHUD(){
  const collected = state.loot.filter(l=>l.collected).length;
  document.getElementById('loot-count').textContent = \`\${collected}/\${state.loot.length}\`;
  const name = LEVEL_NAMES[state.level-1] || 'Level ' + state.level;
  document.getElementById('level-display').textContent = state.level + '/' + LEVELS.length + ' — ' + name + (mpConn ? ' 🤝' : '');
  document.getElementById('score-display').textContent = (state.score||0).toLocaleString();
  const fill = document.getElementById('alert-fill');
  fill.style.width = (state.alert*100)+'%';
  if(state.alert < 0.4) fill.style.background = '#2dc653';
  else if(state.alert < 0.75) fill.style.background = '#f5c518';
  else fill.style.background = '#e63946';
}

// ===================== GAME LOOP =====================
let last = 0;
function loop(ts=0){
  const dt = last === 0 ? 1 : Math.min((ts - last) / 16.67, 3);
  last = ts;
  update(dt);
  draw();
  if(!state.gameOver && !state.won) animFrame = requestAnimationFrame(loop);
}

function update(dt){
  if(state.gameOver || state.won) return;

  // Bob movement
  const sneak = keys['Shift'];
  state.sneaking = sneak;
  const spd = (sneak ? state.bob.sneakSpeed : state.bob.speed) * dt;
  let dx=0, dy=0;
  if(keys['ArrowUp']||keys['w']||keys['W']) dy=-1;
  if(keys['ArrowDown']||keys['s']||keys['S']) dy=1;
  if(keys['ArrowLeft']||keys['a']||keys['A']) dx=-1;
  if(keys['ArrowRight']||keys['d']||keys['D']) dx=1;

  if(dx&&dy){ dx*=0.707; dy*=0.707; }

  const nx = state.bob.x + dx*spd;
  const ny = state.bob.y + dy*spd;
  if(!collidesWall(nx, state.bob.y, state.bob.r)) state.bob.x = nx;
  if(!collidesWall(state.bob.x, ny, state.bob.r)) state.bob.y = ny;

  // Clamp to canvas
  state.bob.x = Math.max(state.bob.r, Math.min(W-state.bob.r, state.bob.x));
  state.bob.y = Math.max(state.bob.r, Math.min(H-state.bob.r, state.bob.y));

  // Collect loot
  state.loot.forEach((l,idx) => {
    if(!l.collected && dist(state.bob, l) < TILE*0.7){
      l.collected = true;
      const val = (ITEMS[l.type] || ITEMS.bag).value;
      state.score += val;
      state.popups = state.popups || [];
      state.popups.push({ x:l.x, y:l.y, text:'+'+val, life:1.0, color:(ITEMS[l.type]||ITEMS.bag).glow });
      mpSend({ type:'loot', idx });
    }
  });

  // Broadcast position to partner
  mpBroadcastPos();

  // Guards patrol + detection
  // Detection rates scale with level: higher level = faster detection, slower decay
  const levelScale = 0.7 + (state.level - 1) * 0.05; // 0.7 at L1, 1.05 at L8
  const detectRate = (sneak ? 0.010 : 0.022) * levelScale;
  const decayRate  = Math.max(0.002, 0.007 - (state.level - 1) * 0.0006); // slows per level

  let anyDetecting = false;
  let bestProximity = 0;

  state.guards.forEach(g => {
    // Move toward next patrol point
    const target = g.patrolPath[g.patrolIdx];
    const ddx = target.x - g.x, ddy = target.y - g.y;
    const d = Math.sqrt(ddx*ddx+ddy*ddy);
    if(d < 3) {
      g.patrolIdx = (g.patrolIdx+1) % g.patrolPath.length;
    } else {
      g.angle = Math.atan2(ddy,ddx);
      g.x += (ddx/d)*g.speed*dt;
      g.y += (ddy/d)*g.speed*dt;
    }

    // Detection — collect best proximity across all guards
    const inFov = inGuardFOV(g, state.bob);
    g.alerting = inFov;
    if(inFov) {
      anyDetecting = true;
      const proximity = 1 - Math.min(dist(g, state.bob)/g.fovDist, 1);
      if(proximity > bestProximity) bestProximity = proximity;
    }
  });

  // Update cameras
  state.cameras.forEach(c => {
    c.t += c.sweepSpeed * dt * 60;
    c.angle = c.baseAngle + Math.sin(c.t) * c.sweepRange;
    const inFov = inGuardFOV(c, state.bob);
    c.alerting = inFov;
    if(inFov) {
      anyDetecting = true;
      const proximity = 1 - Math.min(dist(c, state.bob)/c.fovDist, 1);
      if(proximity > bestProximity) bestProximity = proximity;
    }
  });

  // Update lasers
  state.lasers.forEach(laser => {
    // Check if bob intersects laser line segment
    if(!laser.active) return;
    const dx = laser.x2 - laser.x1, dy = laser.y2 - laser.y1;
    const len = Math.sqrt(dx*dx+dy*dy);
    const t = Math.max(0, Math.min(1, ((state.bob.x-laser.x1)*dx + (state.bob.y-laser.y1)*dy)/(len*len)));
    const cx = laser.x1 + t*dx, cy = laser.y1 + t*dy;
    const d = Math.sqrt((state.bob.x-cx)**2+(state.bob.y-cy)**2);
    if(d < state.bob.r + 4) {
      // instant catch
      state.alert = Math.min(1, state.alert + 0.35 * dt * 60);
    }
  });

  // Tick popups
  if(state.popups) state.popups = state.popups.filter(p=>{ p.life -= 0.02*dt*60; p.y -= 0.4*dt; return p.life > 0; });

  // Apply alert change ONCE per frame based on most threatening guard/camera
  if(anyDetecting) {
    state.alert = Math.min(1, state.alert + detectRate * bestProximity * dt * 60);
  } else {
    state.alert = Math.max(0, state.alert - decayRate * dt * 60);
  }

  // Caught?
  if(state.alert >= 1) {
    state.gameOver = true;
    showOverlay('caught', 'BUSTED!', 'The guard caught you sneaking around.', ()=>startGame(state.level));
    return;
  }

  // Exit check - need all loot
  const allLoot = state.loot.every(l=>l.collected);
  const atExit = dist(state.bob, state.exit) < TILE*0.8 || (p2 && dist(p2, state.exit) < TILE*0.8);
  if(allLoot && atExit) {
    state.won = true;
    const nextLevel = state.level + 1;
    const hasNext = nextLevel <= LEVELS.length;
    if(mpConn) mpSend({ type:'nextLevel', level: hasNext ? nextLevel : 1 });
    showOverlay('win', 
      '🏆 CLEAN GETAWAY!', 
      hasNext ? \`Loot secured! Score: \${state.score.toLocaleString()} → Level \${nextLevel}\` : \`MASTER THIEF! Total score: \${state.score.toLocaleString()}\`,
      hasNext ? ()=>startGame(nextLevel) : ()=>startGame(1),
      hasNext ? \`LEVEL \${nextLevel} ▶\` : 'PLAY AGAIN'
    );
    return;
  }

  updateHUD();
}

function collidesWall(x, y, r) {
  // Check 4 corners
  const corners = [
    [x-r+4,y-r+4],[x+r-4,y-r+4],[x-r+4,y+r-4],[x+r-4,y+r-4]
  ];
  for(const [cx,cy] of corners){
    const tx = Math.floor(cx/TILE), ty = Math.floor(cy/TILE);
    if(state.walls.has(\`\${tx},\${ty}\`)) return true;
  }
  return false;
}

function inGuardFOV(guard, target) {
  const dx = target.x - guard.x, dy = target.y - guard.y;
  const d = Math.sqrt(dx*dx+dy*dy);
  if(d > guard.fovDist) return false;
  const angleToTarget = Math.atan2(dy,dx);
  let angleDiff = angleToTarget - guard.angle;
  while(angleDiff > Math.PI) angleDiff -= 2*Math.PI;
  while(angleDiff < -Math.PI) angleDiff += 2*Math.PI;
  if(Math.abs(angleDiff) > guard.fovAngle) return false;
  // Ray cast for wall blocking
  const steps = 10;
  for(let i=1;i<=steps;i++){
    const rx = guard.x + dx*(i/steps);
    const ry = guard.y + dy*(i/steps);
    const tx = Math.floor(rx/TILE), ty = Math.floor(ry/TILE);
    if(state.walls.has(\`\${tx},\${ty}\`)) return false;
  }
  return true;
}

function dist(a,b){ return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2); }

// ===================== DRAW =====================
function draw(){
  ctx.clearRect(0,0,W,H);

  // Floor tiles
  for(let ty=0;ty<ROWS;ty++){
    for(let tx=0;tx<COLS;tx++){
      if(state.walls.has(\`\${tx},\${ty}\`)){
        // Wall
        ctx.fillStyle = '#1a1a3a';
        ctx.fillRect(tx*TILE, ty*TILE, TILE, TILE);
        // Brick effect
        ctx.strokeStyle = '#0d0d20';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx*TILE+1, ty*TILE+1, TILE-2, TILE-2);
        // Wall highlight
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(tx*TILE, ty*TILE, TILE, 3);
      } else {
        // Floor - checkerboard
        const shade = (tx+ty)%2===0 ? '#13132b' : '#111128';
        ctx.fillStyle = shade;
        ctx.fillRect(tx*TILE, ty*TILE, TILE, TILE);
      }
    }
  }

  // Guard FOV cones
  state.guards.forEach(g => {
    ctx.save();
    ctx.translate(g.x, g.y);
    const alertLevel = state.alert;
    const r = alertLevel < 0.4 ? 80 : alertLevel < 0.75 ? 200 : 240;
    const gg = ctx.createRadialGradient(0,0,0,0,0,g.fovDist);
    if(g.alerting){
      gg.addColorStop(0, \`rgba(\${r},\${alertLevel<0.4?200:alertLevel<0.75?180:50},0,0.35)\`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      gg.addColorStop(0, 'rgba(255,255,180,0.12)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,g.fovDist,-g.fovAngle+g.angle, g.fovAngle+g.angle);
    ctx.closePath();
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.restore();
  });

  // Exit door (only highlight when all loot collected)
  const allLoot = state.loot.every(l=>l.collected);
  ctx.save();
  ctx.translate(state.exit.x, state.exit.y);
  if(allLoot){
    const pulse = 0.7 + 0.3*Math.sin(Date.now()*0.005);
    ctx.shadowColor = '#f5c518';
    ctx.shadowBlur = 20*pulse;
    ctx.fillStyle = \`rgba(245,197,24,\${0.6+0.3*pulse})\`;
    ctx.beginPath();
    ctx.arc(0,0,16,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚪',0,0);
  } else {
    ctx.fillStyle = 'rgba(80,80,80,0.3)';
    ctx.beginPath();
    ctx.arc(0,0,14,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#555';
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚪',0,1);
  }
  ctx.restore();

  // Loot — typed items
  state.loot.forEach(l=>{
    if(l.collected) return;
    const item = ITEMS[l.type] || ITEMS.bag;
    ctx.save();
    ctx.translate(l.x, l.y);
    const floatY = Math.sin(Date.now()*0.004 + l.x*0.1)*3;
    ctx.translate(0, floatY);
    ctx.shadowColor = item.glow;
    ctx.shadowBlur = 16;

    if(l.type === 'bag'){
      // Money bag
      ctx.fillStyle = '#d4a017'; ctx.strokeStyle = item.glow; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0,4,11,12,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,220,0.25)'; ctx.beginPath(); ctx.ellipse(-3,-1,5,7,-0.4,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0; ctx.fillStyle='#a07810'; ctx.beginPath(); ctx.ellipse(0,-7,5,3,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#c49a20'; ctx.beginPath(); ctx.arc(0,-10,4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#7a5c00'; ctx.font='bold 11px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('$',0,5);
    } else if(l.type === 'gem'){
      // Diamond gem
      ctx.fillStyle = item.color; ctx.strokeStyle = item.glow; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(10,0); ctx.lineTo(0,12); ctx.lineTo(-10,0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(10,0); ctx.lineTo(0,-2); ctx.closePath(); ctx.fill();
      ctx.shadowBlur=0; ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.font='bold 9px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('◆',0,1);
    } else if(l.type === 'laptop'){
      // Laptop
      ctx.fillStyle='#555'; ctx.strokeStyle=item.glow; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.roundRect(-12,-8,24,14,2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#1a8fe6'; ctx.fillRect(-10,-6,20,9);
      ctx.fillStyle='rgba(255,255,255,0.1)'; ctx.fillRect(-10,-6,20,4);
      ctx.shadowBlur=0; ctx.fillStyle='#333'; ctx.beginPath(); ctx.roundRect(-13,6,26,4,1); ctx.fill();
      ctx.strokeStyle=item.glow; ctx.lineWidth=1; ctx.strokeRect(-13,6,26,4);
    } else if(l.type === 'painting'){
      // Painting in frame
      ctx.fillStyle='#8B5E3C'; ctx.strokeStyle=item.glow; ctx.lineWidth=2;
      ctx.fillRect(-13,-10,26,20); ctx.strokeRect(-13,-10,26,20);
      ctx.fillStyle='#c0392b'; ctx.fillRect(-10,-7,20,14);
      // simple art pattern
      ctx.fillStyle='#e74c3c'; ctx.beginPath(); ctx.arc(-3,-1,5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#f39c12'; ctx.beginPath(); ctx.arc(4,2,3,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,220,180,0.4)'; ctx.fillRect(-10,-7,20,4);
    } else if(l.type === 'crown'){
      // Crown
      ctx.fillStyle=item.color; ctx.strokeStyle='#fff8a0'; ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.moveTo(-12,6); ctx.lineTo(-12,-4); ctx.lineTo(-6,2); ctx.lineTo(0,-10);
      ctx.lineTo(6,2); ctx.lineTo(12,-4); ctx.lineTo(12,6); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(-6,0,2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#e74c3c'; ctx.beginPath(); ctx.arc(0,-4,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(6,0,2,0,Math.PI*2); ctx.fill();
    }

    // Item value label
    ctx.shadowBlur = 0;
    ctx.font = 'bold 8px Share Tech Mono, monospace';
    ctx.fillStyle = item.glow;
    ctx.textAlign = 'center';
    ctx.fillText('+'+item.value, 0, 18);

    ctx.restore();
  });

  // Draw cameras
  state.cameras.forEach(c=>{
    // FOV cone
    ctx.save();
    ctx.translate(c.x, c.y);
    const cg = ctx.createRadialGradient(0,0,0,0,0,c.fovDist);
    if(c.alerting){
      cg.addColorStop(0,'rgba(255,50,50,0.45)'); cg.addColorStop(1,'rgba(0,0,0,0)');
    } else {
      cg.addColorStop(0,'rgba(100,200,255,0.22)'); cg.addColorStop(1,'rgba(0,0,0,0)');
    }
    ctx.beginPath(); ctx.moveTo(0,0);
    ctx.arc(0,0,c.fovDist, -c.fovAngle+c.angle, c.fovAngle+c.angle);
    ctx.closePath(); ctx.fillStyle=cg; ctx.fill();

    // Camera body
    ctx.rotate(c.angle);
    ctx.fillStyle = c.alerting ? '#e63946' : '#2c2c5e';
    ctx.strokeStyle = c.alerting ? '#ff0000' : '#4cc9f0';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-10,-7,20,14); ctx.strokeRect(-10,-7,20,14);
    // lens
    ctx.fillStyle = c.alerting ? '#ff4444' : '#00d4ff';
    ctx.shadowColor = c.alerting ? '#ff0000' : '#00d4ff';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(7,0,5,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    // mount
    ctx.fillStyle='#1a1a3a'; ctx.fillRect(-3,7,6,6);
    ctx.restore();

    // ! alert
    if(c.alerting){
      ctx.font='bold 16px monospace'; ctx.fillStyle='#e63946';
      ctx.textAlign='center'; ctx.fillText('!',c.x,c.y-22);
    }
  });

  // Draw lasers
  state.lasers.forEach(laser=>{
    if(!laser.active) return;
    const t = Date.now()*0.003;
    const alpha = 0.5 + 0.5*Math.sin(t*3);
    ctx.save();
    ctx.strokeStyle = \`rgba(255,50,50,\${alpha})\`;
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 8;
    ctx.setLineDash([6,4]);
    ctx.beginPath(); ctx.moveTo(laser.x1,laser.y1); ctx.lineTo(laser.x2,laser.y2); ctx.stroke();
    ctx.setLineDash([]);
    // emitter dots
    ctx.shadowBlur = 12;
    ctx.fillStyle='#ff3333';
    ctx.beginPath(); ctx.arc(laser.x1,laser.y1,4,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(laser.x2,laser.y2,4,0,Math.PI*2); ctx.fill();
    ctx.restore();
  });

  // Score popups
  if(state.popups) state.popups.forEach(p=>{
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.font = 'bold 13px Share Tech Mono, monospace';
    ctx.fillStyle = p.color;
    ctx.textAlign = 'center';
    ctx.shadowColor = p.color; ctx.shadowBlur = 8;
    ctx.fillText(p.text, p.x, p.y);
    ctx.restore();
  });

  // Guards
  state.guards.forEach(g=>{
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle + Math.PI/2);
    // Body
    ctx.fillStyle = g.alerting ? '#e63946' : '#3a86ff';
    ctx.beginPath();
    ctx.arc(0,0,14,0,Math.PI*2);
    ctx.fill();
    // Eye/direction indicator
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0,-8,5,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle = g.alerting ? '#e63946' : '#1a1a3e';
    ctx.beginPath();
    ctx.arc(0,-8,3,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Flashlight icon
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.font = '14px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔦', 0, 0);
    ctx.restore();

    // Alert exclamation
    if(state.alert > 0.5 && g.alerting){
      ctx.save();
      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = state.alert > 0.8 ? '#e63946' : '#f5c518';
      ctx.textAlign = 'center';
      ctx.fillText('!', g.x, g.y-24);
      ctx.restore();
    }
  });

  // Bob — hand-drawn canvas character
  ctx.save();
  ctx.translate(state.bob.x, state.bob.y);
  const sneakScale = state.sneaking ? 0.88 : 1;
  ctx.scale(sneakScale, sneakScale);

  // Glow ring
  const glowColor = state.sneaking ? '#4cc9f0' : '#f5c518';
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI*2);
  ctx.fillStyle = state.sneaking ? 'rgba(76,201,240,0.15)' : 'rgba(245,197,24,0.12)';
  ctx.fill();
  ctx.shadowBlur = 0;

  // Body (dark coat)
  ctx.fillStyle = '#1c1c3a';
  ctx.strokeStyle = '#4cc9f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 5, 9, 11, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();

  // Legs (walking bob)
  const legSwing = state.sneaking ? 3 : 5;
  const legAnim = Math.sin(Date.now() * (state.sneaking ? 0.004 : 0.009)) * legSwing;
  ctx.strokeStyle = '#2a2a5a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  // left leg
  ctx.beginPath();
  ctx.moveTo(-4, 13);
  ctx.lineTo(-4 - legAnim*0.5, 20);
  ctx.stroke();
  // right leg
  ctx.beginPath();
  ctx.moveTo(4, 13);
  ctx.lineTo(4 + legAnim*0.5, 20);
  ctx.stroke();
  // Shoes
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.ellipse(-4 - legAnim*0.5, 21, 4, 2.5, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(4 + legAnim*0.5, 21, 4, 2.5, 0, 0, Math.PI*2); ctx.fill();

  // Arms
  ctx.strokeStyle = '#1c1c3a';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  const armSwing = Math.sin(Date.now() * (state.sneaking ? 0.004 : 0.009)) * (state.sneaking ? 4 : 6);
  ctx.beginPath(); ctx.moveTo(-8,3); ctx.lineTo(-13, 9 + armSwing); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8,3); ctx.lineTo(13, 9 - armSwing); ctx.stroke();
  // Hands (holding bag when sneaking / loot collected)
  ctx.fillStyle = '#f5a97a';
  ctx.beginPath(); ctx.arc(-13, 9 + armSwing, 3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(13, 9 - armSwing, 3, 0, Math.PI*2); ctx.fill();

  // Head
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#f5a97a';
  ctx.beginPath();
  ctx.arc(0, -7, 9, 0, Math.PI*2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Beanie / hat
  ctx.fillStyle = state.sneaking ? '#1a5276' : '#922b21';
  ctx.beginPath();
  ctx.ellipse(0, -13, 9, 5, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = state.sneaking ? '#154360' : '#7b241c';
  ctx.fillRect(-9, -15, 18, 5);
  // Hat brim
  ctx.fillStyle = state.sneaking ? '#1a5276' : '#922b21';
  ctx.fillRect(-10, -11, 20, 3);

  // Eyes
  ctx.fillStyle = '#1a1a3a';
  ctx.beginPath(); ctx.arc(-3, -7, 2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(3, -7, 2, 0, Math.PI*2); ctx.fill();
  // Eye shine
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-2.3, -7.7, 0.8, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.7, -7.7, 0.8, 0, Math.PI*2); ctx.fill();

  // Mask / bandana across mouth
  ctx.fillStyle = state.sneaking ? '#154360' : '#7b241c';
  ctx.beginPath();
  ctx.rect(-7, -4, 14, 4);
  ctx.fill();
  // Stripe on mask
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-7,-2); ctx.lineTo(7,-2); ctx.stroke();

  // Sneak label
  if(state.sneaking){
    ctx.shadowBlur = 0;
    ctx.font = 'bold 9px Share Tech Mono, monospace';
    ctx.fillStyle = '#4cc9f0';
    ctx.textAlign = 'center';
    ctx.fillText('SNEAK', 0, -30);
  }

  ctx.restore();

  // Draw Player 2 (remote co-op partner)
  if(p2 && mpConn){
    ctx.save();
    ctx.translate(p2.x, p2.y);
    const p2Scale = p2.sneaking ? 0.88 : 1;
    ctx.scale(p2Scale, p2Scale);
    const p2Glow = p2.sneaking ? '#2dc653' : '#2dc653';
    ctx.shadowColor = p2Glow; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(0,0,15,0,Math.PI*2);
    ctx.fillStyle='rgba(45,198,83,0.12)'; ctx.fill(); ctx.shadowBlur=0;
    // body - green coat
    ctx.fillStyle='#0d3320'; ctx.strokeStyle='#2dc653'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.ellipse(0,5,9,11,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    // legs
    const la2 = Math.sin(Date.now()*0.009)*5;
    ctx.strokeStyle='#0d3320'; ctx.lineWidth=4; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-4,13); ctx.lineTo(-4-la2*0.5,20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4,13); ctx.lineTo(4+la2*0.5,20); ctx.stroke();
    ctx.fillStyle='#111';
    ctx.beginPath(); ctx.ellipse(-4-la2*0.5,21,4,2.5,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4+la2*0.5,21,4,2.5,0,0,Math.PI*2); ctx.fill();
    // arms
    ctx.strokeStyle='#0d3320'; ctx.lineWidth=3.5;
    ctx.beginPath(); ctx.moveTo(-8,3); ctx.lineTo(-13,9+la2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8,3); ctx.lineTo(13,9-la2); ctx.stroke();
    ctx.fillStyle='#c8e6c9';
    ctx.beginPath(); ctx.arc(-13,9+la2,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(13,9-la2,3,0,Math.PI*2); ctx.fill();
    // head
    ctx.shadowColor=p2Glow; ctx.shadowBlur=8;
    ctx.fillStyle='#c8e6c9'; ctx.beginPath(); ctx.arc(0,-7,9,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
    // green beanie
    ctx.fillStyle='#1b5e20';
    ctx.beginPath(); ctx.ellipse(0,-13,9,5,0,Math.PI,0); ctx.fill();
    ctx.fillStyle='#145214'; ctx.fillRect(-9,-15,18,5);
    ctx.fillStyle='#1b5e20'; ctx.fillRect(-10,-11,20,3);
    // eyes
    ctx.fillStyle='#1a3320';
    ctx.beginPath(); ctx.arc(-3,-7,2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(3,-7,2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(-2.3,-7.7,0.8,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(3.7,-7.7,0.8,0,Math.PI*2); ctx.fill();
    // green mask
    ctx.fillStyle='#145214'; ctx.fillRect(-7,-4,14,4);
    // P2 label
    ctx.font='bold 9px Share Tech Mono,monospace'; ctx.fillStyle='#2dc653';
    ctx.textAlign='center'; ctx.fillText('P2', 0, -26);
    ctx.restore();
  }

  // Loot count hint - show remaining
  const remaining = state.loot.filter(l=>!l.collected).length;
  if(!allLoot){
    ctx.save();
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText(\`Collect \${remaining} more loot, then reach the door\`, W/2, H-12);
    ctx.restore();
  } else {
    ctx.save();
    ctx.font = 'bold 12px Share Tech Mono, monospace';
    ctx.fillStyle = '#f5c518';
    ctx.textAlign = 'center';
    const pulse = 0.7+0.3*Math.sin(Date.now()*0.006);
    ctx.globalAlpha = pulse;
    ctx.fillText('🚪 REACH THE EXIT!', W/2, H-12);
    ctx.restore();
  }
}

// ===================== MULTIPLAYER — WebRTC + kvdb.io signaling =====================
// kvdb.io is a free public key-value store. No signup required.
// We use it ONLY for SDP/ICE exchange (handshake), then go peer-to-peer.
// Bucket is shared — room codes prevent collisions. Data is tiny & temporary.

// Signal server: /api/signal (Vercel serverless function - included in this package)
const SIGNAL_URL = '/api/signal';

let rtcConn = null, dataChannel = null;
let mpRole = null;
let mpRoomCode = null;
let p2 = null;
let mpConnected = false;
let mpPollTimer = null;

function mpStatus(elId, msg, color='#888'){
  const el = document.getElementById(elId);
  if(el){ el.textContent = msg; el.style.color = color; }
}

function showMultiplayerInfo(){
  document.getElementById('mp-modal').style.display='flex';
}

function mpClose(){
  document.getElementById('mp-modal').style.display='none';
  document.getElementById('host-code-area').style.display='none';
  document.getElementById('btn-host').style.display='inline-block';
  document.getElementById('btn-host').disabled=false;
  document.getElementById('btn-host').textContent='Generate Room Code';
  mpStatus('host-status','Waiting for partner...');
  mpStatus('join-status','');
  document.getElementById('join-code-input').value='';
  if(mpPollTimer){ clearInterval(mpPollTimer); mpPollTimer=null; }
  // Clean up KV room
  if(mpRoomCode){
    kvDel(mpRoomCode+'-offer');
    kvDel(mpRoomCode+'-answer');
    mpRoomCode=null;
  }
}

function genCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<4;i++) s+=c[Math.floor(Math.random()*c.length)]; return s;
}

function makeRTC(){
  return new RTCPeerConnection({ iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
    {urls:'stun:stun.cloudflare.com:3478'},
    {urls:'stun:stun.relay.metered.ca:80'},
  ]});
}

// Signal helpers — POST/GET/DELETE to /api/signal
async function kvSet(key, val){
  try{
    await fetch(SIGNAL_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({key, val: typeof val==='string'?val:JSON.stringify(val)})
    });
  }catch(e){ console.warn('kvSet fail',e); }
}
async function kvGet(key){
  try{
    const r = await fetch(\`\${SIGNAL_URL}?key=\${encodeURIComponent(key)}\`);
    if(!r.ok) return null;
    const d = await r.json();
    return d.val || null;
  }catch(e){ return null; }
}
async function kvDel(key){
  try{
    await fetch(SIGNAL_URL,{
      method:'DELETE',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({key})
    });
  }catch(e){}
}

// Wait for ICE gathering to complete (max 4s)
function waitForICE(pc){
  return new Promise(resolve=>{
    if(pc.iceGatheringState==='complete') return resolve();
    pc.onicegatheringstatechange = ()=>{ if(pc.iceGatheringState==='complete') resolve(); };
    setTimeout(resolve, 4000);
  });
}

// ---- HOST ----
async function mpHost(){
  const btn = document.getElementById('btn-host');
  btn.disabled=true; btn.textContent='Setting up...';
  mpStatus('host-status','Creating room...','#f5c518');

  const code = genCode();
  mpRoomCode = code;
  mpRole = 'host';

  rtcConn = makeRTC();
  dataChannel = rtcConn.createDataChannel('game',{ordered:false, maxRetransmits:2});
  setupDataChannel(dataChannel);

  const offer = await rtcConn.createOffer();
  await rtcConn.setLocalDescription(offer);
  await waitForICE(rtcConn);

  // Store offer SDP in KV
  await kvSet(code+'-offer', rtcConn.localDescription.sdp);

  document.getElementById('host-code').textContent = code;
  document.getElementById('host-code-area').style.display='block';
  btn.style.display='none';
  mpStatus('host-status','⏳ Waiting for partner...','#f5c518');

  // Poll for answer (every 1.5s)
  let attempts = 0;
  mpPollTimer = setInterval(async ()=>{
    attempts++;
    if(attempts > 40){ // 60s timeout
      clearInterval(mpPollTimer);
      mpStatus('host-status','❌ Timed out. Try again.','#e63946');
      return;
    }
    const answerSdp = await kvGet(code+'-answer');
    if(!answerSdp) return;
    clearInterval(mpPollTimer); mpPollTimer=null;
    try{
      await rtcConn.setRemoteDescription({type:'answer', sdp:answerSdp});
      mpStatus('host-status','🔗 Connecting...','#f5c518');
    }catch(e){ mpStatus('host-status','❌ SDP error: '+e.message,'#e63946'); }
  }, 1500);

  rtcConn.onconnectionstatechange = ()=>{
    if(rtcConn.connectionState==='connected'){
      mpConnected=true;
      mpStatus('host-status','✅ Connected! Starting...','#2dc653');
      kvDel(code+'-offer'); kvDel(code+'-answer');
      setTimeout(()=>{
        document.getElementById('mp-modal').style.display='none';
        startGame(1);
        mpSend({type:'startLevel',level:1});
      }, 600);
    } else if(['failed','disconnected'].includes(rtcConn.connectionState)){
      mpOnDisconnect();
    }
  };
}

// ---- JOIN ----
async function mpJoin(){
  const raw = document.getElementById('join-code-input').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
  if(raw.length<4){ mpStatus('join-status','⚠️ Enter the 4-character code','#f5c518'); return; }

  mpStatus('join-status','🔍 Looking up room...','#f5c518');
  const code = raw;
  mpRoomCode = code;

  const offerSdp = await kvGet(code+'-offer');
  if(!offerSdp){
    mpStatus('join-status','❌ Room not found. Check code & host must be waiting.','#e63946');
    return;
  }

  mpStatus('join-status','🔗 Connecting...','#f5c518');
  mpRole = 'peer';

  rtcConn = makeRTC();
  rtcConn.ondatachannel = e=>{ dataChannel=e.channel; setupDataChannel(dataChannel); };

  await rtcConn.setRemoteDescription({type:'offer', sdp:offerSdp});
  const answer = await rtcConn.createAnswer();
  await rtcConn.setLocalDescription(answer);
  await waitForICE(rtcConn);

  // Store answer SDP in KV
  await kvSet(code+'-answer', rtcConn.localDescription.sdp);
  mpStatus('join-status','⏳ Waiting for host to connect...','#f5c518');

  rtcConn.onconnectionstatechange = ()=>{
    if(rtcConn.connectionState==='connected'){
      mpConnected=true;
      mpStatus('join-status','✅ Connected! Waiting for host...','#2dc653');
    } else if(['failed','disconnected'].includes(rtcConn.connectionState)){
      mpStatus('join-status','❌ Connection lost','#e63946');
      mpOnDisconnect();
    }
  };

  setTimeout(()=>{
    if(!mpConnected) mpStatus('join-status','❌ Timed out. Check the code and try again.','#e63946');
  }, 15000);
}

// ---- SHARED ----
function setupDataChannel(ch){
  ch.onopen  = ()=>{ mpConnected=true; };
  ch.onclose = ()=>mpOnDisconnect();
  ch.onerror = e=>console.warn('DC error',e);
  ch.onmessage = e=>{ try{ mpOnData(JSON.parse(e.data)); }catch(err){} };
}

function mpOnData(data){
  if(!data||!data.type) return;
  if(data.type==='startLevel'){
    document.getElementById('mp-modal').style.display='none';
    startGame(data.level||1);
  } else if(data.type==='pos'&&state){
    if(!p2) p2={x:data.x,y:data.y,sneaking:!!data.sneaking};
    else { p2.x=data.x; p2.y=data.y; p2.sneaking=!!data.sneaking; }
  } else if(data.type==='loot'&&state){
    if(state.loot[data.idx]&&!state.loot[data.idx].collected) state.loot[data.idx].collected=true;
  } else if(data.type==='nextLevel'){
    const n=data.level;
    if(n&&n<=LEVELS.length) startGame(n); else startGame(1);
  }
}

function mpOnDisconnect(){
  mpConnected=false; p2=null;
  if(state&&!state.gameOver&&!state.won)
    showOverlay('caught','PARTNER LEFT','Your co-op partner disconnected.',()=>startGame(state.level),'RESTART');
}

function mpSend(data){
  if(dataChannel&&dataChannel.readyState==='open')
    try{ dataChannel.send(JSON.stringify(data)); }catch(e){}
}

// mpConn shim so existing code that checks mpConn still works
Object.defineProperty(window,'mpConn',{get(){ return mpConnected?dataChannel:null; },configurable:true});

function mpBroadcastPos(){
  if(!mpConnected||!state) return;
  mpSend({type:'pos',x:Math.round(state.bob.x),y:Math.round(state.bob.y),sneaking:!!state.sneaking});
}

function showOverlay(type, title, msg, onBtn, btnLabel='TRY AGAIN'){
  const ov = document.getElementById('overlay');
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-msg').textContent = msg;
  const btn = document.getElementById('overlay-btn');
  btn.textContent = btnLabel;
  btn.onclick = onBtn;
  ov.className = type + ' show';
  ov.style.display = 'flex';
}
</script>
</body>
</html>
`;

export default {
    async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

        // ── Signaling API ──────────────────────────────────────────────────────
        if (path === '/api/signal') {
            storeClean();

            if (method === 'GET') {
                const key = url.searchParams.get('key');
                if (!key) return j({ error: 'missing key' }, 400);
                const entry = store.get(key);
                return j({ val: entry ? entry.val : null });
            }

            if (method === 'POST') {
                let body;
                try { body = await request.json(); } catch { return j({ error: 'bad json' }, 400); }
                if (!body.key || body.val === undefined) return j({ error: 'missing key/val' }, 400);
                store.set(body.key, { val: String(body.val), expires: Date.now() + 5 * 60 * 1000 });
                return j({ ok: true });
            }

            if (method === 'DELETE') {
                let body;
                try { body = await request.json(); } catch { return j({ error: 'bad json' }, 400); }
                if (body.key) store.delete(body.key);
                return j({ ok: true });
            }

            return j({ error: 'method not allowed' }, 405);
        }

        // ── Serve game ─────────────────────────────────────────────────────────
        return cors(new Response(GAME_HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }));
    }
};