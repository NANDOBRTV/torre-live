const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

app.use(express.static('public', { extensions: ['html'] }));

const TIKTOK_USERNAME = (process.env.TIKTOK_USERNAME || 'nandobr_ofc')
  .trim()
  .replace(/^@/, '');
const TIKTOK_SESSION_ID = (process.env.TIKTOK_SESSION_ID || '').trim();
const PORT = Number(process.env.PORT) || 3000;

let liveStatus = {
  connected: false,
  connecting: false,
  username: TIKTOK_USERNAME,
  roomId: null,
  message: 'Servidor iniciado; verificando a LIVE.'
};

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'torre-live',
    uptime: Math.floor(process.uptime()),
    tiktok: liveStatus
  });
});

function publishStatus(message) {
  liveStatus.message = message;
  io.emit('connection-status', { ...liveStatus });
  console.log('[STATUS]', message);
}

io.on('connection', socket => {
  socket.emit('connection-status', { ...liveStatus });
  socket.emit('server-ready', { ok: true, username: TIKTOK_USERNAME });
});

const connectionOptions = {
  processInitialData: false,
  enableWebsocketUpgrade: true,
  requestOptions: { timeout: 15000 },
  websocketOptions: { timeout: 15000 }
};
if (TIKTOK_SESSION_ID) connectionOptions.sessionId = TIKTOK_SESSION_ID;

const tiktokConnection = new TikTokLiveConnection(TIKTOK_USERNAME, connectionOptions);
let reconnectTimer = null;
let connectInProgress = false;
let shuttingDown = false;

function scheduleReconnect(delay = 15000) {
  if (shuttingDown || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToLive();
  }, delay);
}

async function connectToLive() {
  if (shuttingDown || connectInProgress || liveStatus.connected) return;
  connectInProgress = true;
  liveStatus.connecting = true;
  publishStatus(`Tentando localizar a LIVE pública de @${TIKTOK_USERNAME}...`);

  try {
    const state = await tiktokConnection.connect();
    liveStatus.connected = true;
    liveStatus.connecting = false;
    liveStatus.roomId = state?.roomId ?? null;
    publishStatus(`Conectado à LIVE de @${TIKTOK_USERNAME}.`);
  } catch (error) {
    liveStatus.connected = false;
    liveStatus.connecting = false;
    liveStatus.roomId = null;
    const message = error?.message || 'Falha desconhecida ao conectar.';
    publishStatus(`Não conectou: ${message}. Nova tentativa em 15 segundos.`);
    scheduleReconnect(15000);
  } finally {
    connectInProgress = false;
  }
}

function eventName(key, fallback) {
  return WebcastEvent && WebcastEvent[key] ? WebcastEvent[key] : fallback;
}

tiktokConnection.on(eventName('CHAT', 'chat'), data => {
  const user = data?.user?.displayId || data?.user?.uniqueId || data?.uniqueId || 'Espectador';
  const comment = String(data?.comment ?? data?.content ?? '');
  io.emit('chat', { user, comment, timestamp: Date.now() });
});

tiktokConnection.on(eventName('GIFT', 'gift'), data => {
  // Presentes em sequência só pontuam quando a sequência termina.
  if (data?.giftType === 1 && data?.repeatEnd === false) return;
  const giftName = data?.gift?.name || data?.giftName || 'Presente';
  const user = data?.user?.displayId || data?.user?.uniqueId || data?.uniqueId || 'Fã';
  const repeatCount = Math.max(1, Number(data?.repeatCount) || 1);
  const diamondCount = Math.max(1, Number(data?.diamondCount) || 1);
  const giftImageUrl = data?.gift?.image?.url_list?.[0]
    || data?.gift?.image?.urlList?.[0]
    || data?.giftPictureUrl
    || data?.giftImageUrl
    || null;
  const giftId = Number(data?.gift?.gift_id ?? data?.giftId ?? data?.gift_id) || null;
  io.emit('gift', { user, giftName, giftId, giftImageUrl, diamondCount, repeatCount, timestamp: Date.now() });
});

tiktokConnection.on(eventName('LIKE', 'like'), data => {
  io.emit('like', {
    user: data?.user?.displayId || data?.user?.uniqueId || 'Espectador',
    likeCount: Math.max(1, Number(data?.likeCount) || 1),
    totalLikeCount: Number(data?.totalLikeCount) || 0,
    timestamp: Date.now()
  });
});

tiktokConnection.on(eventName('FOLLOW', 'follow'), data => {
  io.emit('follow', {
    user: data?.user?.displayId || data?.user?.uniqueId || 'Novo seguidor',
    timestamp: Date.now()
  });
});

tiktokConnection.on(eventName('SHARE', 'share'), data => {
  io.emit('share', {
    user: data?.user?.displayId || data?.user?.uniqueId || 'Espectador',
    timestamp: Date.now()
  });
});

tiktokConnection.on(eventName('MEMBER', 'member'), data => {
  io.emit('member', {
    user: data?.user?.displayId || data?.user?.uniqueId || 'Espectador',
    timestamp: Date.now()
  });
});

tiktokConnection.on('disconnected', () => {
  liveStatus.connected = false;
  liveStatus.connecting = false;
  liveStatus.roomId = null;
  publishStatus('A conexão com o TikTok foi encerrada. Tentando novamente.');
  scheduleReconnect(5000);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor torre-live rodando na porta ${PORT}`);
  console.log(`Usuário TikTok configurado: @${TIKTOK_USERNAME}`);
  connectToLive();
});

process.on('SIGTERM', () => {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { tiktokConnection.disconnect(); } catch (_) {}
  server.close(() => process.exit(0));
});
