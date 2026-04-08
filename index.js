const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

const orderStates = {};

// 🔥 FETCH SIM PACKAGES
async function getSimPackages(network) {
    const res = await fetch(`${FIREBASE_URL}/sim_packages/${network}.json`);
    return await res.json();
}

// 🔥 FETCH TOOLS
async function getTools() {
    const res = await fetch(`${FIREBASE_URL}/tools.json`);
    return await res.json();
}

async function startBot() {

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
        const text = (msg.message.conversation || "").toLowerCase();

        console.log(`📩 ${text}`);

        // 👋 MAIN MENU
        if (text.includes("hi") || text.includes("hello")) {
            await sock.sendMessage(sender, {
                text: `👋 *Assalam Alaikum*

✨ Welcome to *Digital Zone*

📌 Please select:

📶 *Sim Packages*
🛠 *Tools*`
            });
        }

        // 📶 SIM MENU
        else if (text === "sim packages") {
            await sock.sendMessage(sender, {
                text: `📶 *Sim Packages*

📡 *Telenor*
📡 *Zong*
📡 *Jazz*
📡 *Ufone*`
            });
        }

        // 📡 NETWORK SELECT
        else if (["telenor","zong","jazz","ufone"].includes(text)) {

            const data = await getSimPackages(text);

            if (!data) {
                await sock.sendMessage(sender, { text: "❌ No packages available." });
                return;
            }

            let msgText = `📡 *${text.toUpperCase()} PACKAGES*\n\n`;

            Object.values(data).forEach(p => {
                msgText += `📦 *${p.name}* - PKR ${p.price}\n`;
            });

            msgText += `\n🛒 Type package name to order`;

            await sock.sendMessage(sender, { text: msgText });
        }

        // 🛒 PACKAGE SELECT
        else {

            const networks = ["telenor","zong","jazz","ufone"];

            for (let net of networks) {
                const data = await getSimPackages(net);

                if (data) {
                    const found = Object.values(data).find(p => p.name.toLowerCase() === text);

                    if (found) {
                        orderStates[sender] = {
                            step: "WAITING_NUMBER",
                            item: found
                        };

                        await sock.sendMessage(sender, {
                            text: `🛒 *Order Selected*

📦 Package: *${found.name}*
💰 Price: PKR ${found.price}

📱 Please send number:
jis number par package lagana hai`
                        });

                        return;
                    }
                }
            }
        }

        // 📱 NUMBER INPUT
        if (orderStates[sender]?.step === "WAITING_NUMBER") {

            const item = orderStates[sender].item;

            const orderData = {
                phone: text,
                package: item.name,
                price: item.price,
                status: "Placed",
                time: new Date().toISOString()
            };

            await fetch(`${FIREBASE_URL}/orders.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            });

            await sock.sendMessage(sender, {
                text: `✅ *Order Placed Successfully!*

📦 Package: *${item.name}*
📱 Number: ${text}
💰 Amount: PKR ${item.price}

🚀 Your package will be activated shortly.

🙏 Thank you for choosing *Digital Zone*!`
            });

            delete orderStates[sender];
            return;
        }

        // 🛠 TOOLS
        else if (text === "tools") {

            const tools = await getTools();

            let msgText = `🛠 *Tools*\n\n`;

            Object.values(tools || {}).forEach(t => {
                msgText += `🤖 *${t.name}*\n`;
            });

            await sock.sendMessage(sender, { text: msgText });
        }

        else {
            await sock.sendMessage(sender, { text: "❓ Type *hi* to start" });
        }

    });
}

startBot();
