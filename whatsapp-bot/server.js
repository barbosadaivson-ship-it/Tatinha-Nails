const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Inicializa o cliente WhatsApp com salvamento de sessão local
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    }
});

client.on('qr', (qr) => {
    console.log('\n=============================================');
    console.log('📱 ESCANEIE O QR CODE COM SEU WHATSAPP 📱');
    console.log('=============================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n✅ Robô do WhatsApp conectado com sucesso!');
    console.log('   Pronto para enviar as mensagens automáticas.\n');
});

client.on('auth_failure', () => {
    console.error('❌ Falha na autenticação do WhatsApp.');
});

client.initialize();

// Endpoint para receber ordens do Frontend (app.js)
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    
    if (!phone || !message) {
        return res.status(400).json({ error: 'Parâmetros phone e message são obrigatórios.' });
    }

    try {
        // whatsapp-web.js exige o número com formato @c.us
        // Exemplo: 5511999999999@c.us
        const chatId = `${phone}@c.us`; 
        
        await client.sendMessage(chatId, message);
        console.log(`[SUCESSO] Mensagem enviada para ${phone}`);
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error(`[ERRO] Falha ao enviar para ${phone}:`, error);
        res.status(500).json({ error: 'Erro ao enviar mensagem.' });
    }
});

// Inicia servidor Express na porta 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor local rodando na porta ${PORT}`);
    console.log(`Aguardando inicialização do WhatsApp...\n`);
});
