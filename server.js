const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Pega o usuário das variáveis do Render ou usa o padrão
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'nandobr_ofc';

// IMPORTANTE NO RENDER: Datacenters em nuvem costumam exigir sessionId
const TIKTOK_SESSION_ID = process.env.TIKTOK_SESSION_ID || '';

const connectionOptions = {
    processInitialData: false,
    enableWebsocketUpgrade: true,
    requestOptions: { timeout: 10000 },
    websocketOptions: { timeout: 10000 }
};

if (TIKTOK_SESSION_ID && TIKTOK_SESSION_ID.trim() !== '') {
    connectionOptions.sessionId = TIKTOK_SESSION_ID.trim();
}

const tiktokConnection = new TikTokLiveConnection(TIKTOK_USERNAME, connectionOptions);

function connectToLive() {
    console.log(`\n[TIKTOK] Tentando conectar à live de @${TIKTOK_USERNAME}...`);

    tiktokConnection.connect().then(state => {
        console.log(`✅ CONECTADO! Sala ID: ${state.roomId}`);
    }).catch(err => {
        console.log(`❌ Erro ao conectar: ${err.message}`);
        console.log(`[AGUARDANDO] Tentando reconectar em 10 segundos...`);
        setTimeout(connectToLive, 10000);
    });
}

// Repassa chat
tiktokConnection.on(WebcastEvent?.CHAT || 'chat', data => {
    const comment = data.content || data.comment || '';
    const user = data.user?.displayId || data.uniqueId || 'Espectador';
    io.emit('chat', { user, comment });
});

// Repassa presentes
tiktokConnection.on(WebcastEvent?.GIFT || 'gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    const giftName = data.gift?.name || data.giftName || 'Presente';
    const user = data.user?.displayId || data.uniqueId || 'Fã';
    io.emit('gift', { user, giftName, diamondCount: data.diamondCount || 1 });
});

tiktokConnection.on('disconnected', () => {
    console.log('⚠️ Conexão perdida. Reconectando...');
    setTimeout(connectToLive, 5000);
});

connectToLive();

// PORTA DINÂMICA DO RENDER
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
