const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

// 🔥 SIM PACKAGES
async function getSimPackages(network) {
    const res = await fetch(`${FIREBASE_URL}/sim_packages/${network}.json`);
    return await res.json();
}

// 🔥 TOOLS
async function getTools() {
    const res = await fetch(`${FIREBASE_URL}/tools.json`);
    return await res.json();
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ FIREBASE_URL missing!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.clear();
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') console.log('✅ DIGITAL ZONE BOT ONLINE!');
        if (connection === 'close') {
            const reason = update?.lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

        console.log(`📩 ${text}`);

        // 👋 GREETING
        if (text.includes("hi") || text.includes("hello")) {
            await sock.sendMessage(sender, { 
                text: `Assalam Alaikum

Welcome to Digital Zone

1) Sim Packages
2) Tools`
            });
        }

        // 📶 SIM MENU
        else if (text === "1") {
            await sock.sendMessage(sender, { 
                text: `*Sim Packages*

1) Telenor
2) Jazz
3) Zong
4) Ufone`
            });
        }

        // 🛠 TOOLS MENU (Firebase)
        else if (text === "2") {
            const tools = await getTools();

            let msg = "*Tools*\n\n";
            Object.values(tools || {}).forEach((t, i) => {
                msg += `${i+1}) ${t.name}\n`;
            });

            await sock.sendMessage(sender, { text: msg });
        }

        // 📡 SIM NETWORKS (Firebase)
        else if (text === "telenor" || text === "1") {
            const data = await getSimPackages("telenor");

            let msg = "*Telenor Packages*\n\n";
            Object.values(data || {}).forEach((p, i) => {
                msg += `${i+1}) ${p.name} - PKR ${p.price}\n`;
            });

            await sock.sendMessage(sender, { text: msg });
        }

        else if (text === "jazz" || text === "2") {
            const data = await getSimPackages("jazz");

            let msg = "*Jazz Packages*\n\n";
            Object.values(data || {}).forEach((p, i) => {
                msg += `${i+1}) ${p.name} - PKR ${p.price}\n`;
            });

            await sock.sendMessage(sender, { text: msg });
        }

        else if (text === "zong" || text === "3") {
            const data = await getSimPackages("zong");

            let msg = "*Zong Packages*\n\n";
            Object.values(data || {}).forEach((p, i) => {
                msg += `${i+1}) ${p.name} - PKR ${p.price}\n`;
            });

            await sock.sendMessage(sender, { text: msg });
        }

        else if (text === "ufone" || text === "4") {
            const data = await getSimPackages("ufone");

            let msg = "*Ufone Packages*\n\n";
            Object.values(data || {}).forEach((p, i) => {
                msg += `${i+1}) ${p.name} - PKR ${p.price}\n`;
            });

            await sock.sendMessage(sender, { text: msg });
        }

        else {
            await sock.sendMessage(sender, { text: "Type hi to start" });
        }

    });
}

startBot();
