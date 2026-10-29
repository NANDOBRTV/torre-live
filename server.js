const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir a pasta do jogo (onde fica o index.html)
app.use(express.static('public'));

// SEU USUÁRIO DO TIKTOK (Sem o @)
const TIKTOK_USERNAME = 'nandobr_ofc';

// Se tiver erro 403, cole seu sessionid entre as aspas. Senão, deixe vazio.
const TIKTOK_SESSION_ID = '';

const connectionOptions = {
    processInitialData: false,
    enableWebsocketUpgrade: true,
    requestOptions: {
        timeout: 10000
    },
    websocketOptions: {
        timeout: 10000
    }
};

if (TIKTOK_SESSION_ID && TIKTOK_SESSION_ID.trim() !== '') {
    connectionOptions.sessionId = TIKTOK_SESSION_ID.trim();
}

// Cria a conexão com o TikTok
const tiktokConnection = new TikTokLiveConnection(TIKTOK_USERNAME, connectionOptions);

// Função para conectar à Live
function connectToLive() {
    console.log(`\n[TIKTOK] Tentando conectar à live de @${TIKTOK_USERNAME}...`);

    tiktokConnection.connect().then(state => {
        console.log(`✅ CONECTADO COM SUCESSO! Sala ID: ${state.roomId}`);
        console.log(`🎮 O jogo está ouvindo os comentários e presentes da live!\n`);
    }).catch(err => {
        console.log(`❌ Live ainda offline ou erro: ${err.message}`);
        console.log(`[AGUARDANDO] Tentando reconectar em 10 segundos...`);
        setTimeout(connectToLive, 10000);
    });
}

// 1. REPASSA COMENTÁRIOS DO CHAT PARA O JOGO
tiktokConnection.on(WebcastEvent?.CHAT || 'chat', data => {
    const comment = data.content || data.comment || '';
    const user = data.user?.displayId || data.uniqueId || 'Espectador';

    console.log(`[CHAT] ${user}: ${comment}`);

    // Envia para o HTML
    io.emit('chat', {
        user: user,
        comment: comment
    });
});

// 2. REPASSA PRESENTES (GIFTS) PARA O JOGO
tiktokConnection.on(WebcastEvent?.GIFT || 'gift', data => {
    // Evita spam de combo incompleto de rosas
    if (data.giftType === 1 && !data.repeatEnd) return;

    const giftName = data.gift?.name || data.giftName || 'Presente';
    const user = data.user?.displayId || data.uniqueId || 'Fã';

    console.log(`🎁 [PRESENTE] ${user} enviou: ${giftName}`);

    // Envia para o HTML
    io.emit('gift', {
        user: user,
        giftName: giftName,
        diamondCount: data.diamondCount || 1
    });
});

// Reconexão automática caso a internet oscile
tiktokConnection.on('disconnected', () => {
    console.log('⚠️ Conexão perdida. Tentando reconectar em 5 segundos...');
    setTimeout(connectToLive, 5000);
});

// Inicia a conexão
connectToLive();

// INICIA O SERVIDOR WEB LOCAL
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(`🚀 SERVIDOR DO JOGO LIVECADE RODANDO!`);
    console.log(`👉 Abra no navegador: http://localhost:${PORT}`);
    console.log(`===============================================`);
});
