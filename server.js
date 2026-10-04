// ============================================================
// Long Drive Web — Online Server
// ============================================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `video_${ts}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/video\//.test(file.mimetype) || /\.(mp4|webm|ogg|mov|m4v)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Только видео (mp4/webm/ogg/mov)'));
    }
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let currentVideo = null;
const players = new Map();

function broadcast(msg, exceptWs = null) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1 && ws !== exceptWs) ws.send(data);
  }
}
function broadcastPlayers() {
  broadcast({ type: 'players', list: Array.from(players.values()) });
}

app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const url = '/uploads/' + req.file.filename;
  const name = req.file.originalname;
  const from = req.body.nickname || 'Anonymous';
  currentVideo = { url, name, startedAt: Date.now(), from };
  console.log(`📺 Новое видео: ${name} от ${from}`);
  broadcast({ type: 'play', video: currentVideo });
  res.json({ ok: true, url, video: currentVideo });
});

app.get('/current', (req, res) => {
  res.json({ currentVideo, players: Array.from(players.values()) });
});

wss.on('connection', (ws) => {
  console.log('🔌 Игрок подключился');
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }

    switch (msg.type) {
      case 'join': {
        const nickname = (msg.nickname || 'Anonymous').slice(0, 16);
        players.set(ws, nickname);
        console.log(`👤 ${nickname} вошёл`);
        ws.send(JSON.stringify({
          type: 'init',
          currentVideo,
          players: Array.from(players.values())
        }));
        broadcastPlayers();
        broadcast({ type: 'join', nickname }, ws);
        break;
      }
      case 'play': {
        if (!msg.url) return;
        currentVideo = {
          url: msg.url,
          name: msg.name || 'video',
          startedAt: Date.now(),
          from: players.get(ws) || 'Anonymous',
        };
        broadcast({ type: 'play', video: currentVideo });
        break;
      }
      case 'stop': {
        currentVideo = null;
        broadcast({ type: 'stop', from: players.get(ws) || 'Anonymous' });
        break;
      }
      case 'seek': {
        if (!currentVideo) return;
        currentVideo.startedAt = Date.now() - (msg.time || 0) * 1000;
        broadcast({ type: 'seek', time: msg.time, from: players.get(ws) });
        break;
      }
    }
  });
  ws.on('close', () => {
    const nick = players.get(ws);
    if (nick) {
      console.log(`👤 ${nick} вышел`);
      players.delete(ws);
      broadcastPlayers();
      broadcast({ type: 'leave', nickname: nick });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔════════════════════════════════════════════╗');
  console.log('  ║    LONG DRIVE WEB — ONLINE                 ║');
  console.log('  ╠════════════════════════════════════════════╣');
  console.log(`  ║    Открой: http://localhost:${PORT}           ║`);
  console.log('  ╚════════════════════════════════════════════╝');
  console.log('');
});
