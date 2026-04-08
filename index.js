const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

const orderStates = {};

async function getSimPackages(network) {
    const res = await fetch(`${FIREBASE_URL}/sim_packages/${network}.json`);
    return await res.json();
}

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

        // MAIN MENU
        if (text === "hi" || text === "menu") {
            orderStates[sender] = { step: "MAIN" };

            await sock.sendMessage(sender, {
                text: `👋 *Assalam Alaikum*

✨ Welcome to *Digital Zone*

1️⃣ *Sim Packages*
2️⃣ *Tools*

🔙 Type M anytime for Menu`
            });
        }

        // MAIN MENU OPTIONS
        else if (text === "1" && orderStates[sender]?.step === "MAIN") {
            orderStates[sender] = { step: "SIM_MENU" };

            await sock.sendMessage(sender, {
                text: `📶 *Sim Packages*

🅣 *Telenor*
🅩 *Zong*

Reply:
T → Telenor
Z → Zong

🔙 B = Back`
            });
        }

        else if (text === "2" && orderStates[sender]?.step === "MAIN") {
            orderStates[sender] = { step: "TOOLS" };

            const tools = await getTools();

            let msgText = `🛠 *Tools*\n\n`;

            Object.values(tools || {}).forEach((t, i) => {
                msgText += `${i+1}) ${t.name}\n`;
            });

            msgText += `\n🔙 B = Back`;

            await sock.sendMessage(sender, { text: msgText });
        }

        // BACK / MENU
        else if (text === "m") {
            orderStates[sender] = { step: "MAIN" };
            await sock.sendMessage(sender, { text: "🔙 Back to Main Menu\n\nType hi" });
        }

        else if (text === "b") {
            orderStates[sender] = { step: "MAIN" };
            await sock.sendMessage(sender, { text: "🔙 Back\n\nType hi" });
        }

        // NETWORK SELECT
        else if (["t","z"].includes(text) && orderStates[sender]?.step === "SIM_MENU") {

            const network = text === "t" ? "telenor" : "zong";
            const data = await getSimPackages(network);

            orderStates[sender] = { step: "PACKAGE_SELECT", network, data };

            let msg = `📡 *${network.toUpperCase()} PACKAGES*\n\n`;

            Object.values(data || {}).forEach((p, i) => {
                msg += `${i+1}) ${p.name} - PKR ${p.price}\n`;
            });

            msg += `\nSelect package number`;

            await sock.sendMessage(sender, { text: msg });
        }

        // PACKAGE SELECT
        else if (orderStates[sender]?.step === "PACKAGE_SELECT") {

            const index = parseInt(text) - 1;
            const packages = Object.values(orderStates[sender].data || {});

            if (packages[index]) {

                const selected = packages[index];

                orderStates[sender] = {
                    step: "WAITING_NUMBER",
                    item: selected
                };

                await sock.sendMessage(sender, {
                    text: `🛒 *Order Selected*

📦 ${selected.name}
💰 PKR ${selected.price}

📱 Enter number:`
                });
            }
        }

        // NUMBER INPUT
        else if (orderStates[sender]?.step === "WAITING_NUMBER") {

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

📦 ${item.name}
📱 ${text}
💰 PKR ${item.price}

🚀 Processing...

🙏 Thanks for choosing Digital Zone`
            });

            delete orderStates[sender];
        }

        else {
            await sock.sendMessage(sender, { text: "❓ Type hi to start" });
        }

    });
}

startBot();
