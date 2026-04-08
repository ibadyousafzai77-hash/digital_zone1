const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');
const chalk = require('chalk'); // Terminal styling ke liye

// --- CONFIGURATION ---
const FIREBASE_URL = "APNI_FIREBASE_URL_YAHAN_LIKHEN"; // Apna Firebase Link yahan dalen
const userState = {};

// --- STYLISH CONSOLE LOGS ---
const log = {
    info: (msg) => console.log(chalk.cyan.bold(' [INFO] ') + chalk.white(msg)),
    success: (msg) => console.log(chalk.green.bold(' [SUCCESS] ') + chalk.white(msg)),
    error: (msg) => console.log(chalk.red.bold(' [ERROR] ') + chalk.white(msg)),
    msg: (from, text) => console.log(chalk.yellow.bold(` 📩 Message: `) + chalk.white(`${from} -> ${text}`))
};

// --- DATA HANDLERS ---
async function fetchData(path) {
    try {
        const res = await fetch(`${FIREBASE_URL}/${path}.json`);
        return await res.json();
    } catch (e) {
        log.error("Data fetch fail: " + e.message);
        return null;
    }
}

async function postData(path, data) {
    try {
        await fetch(`${FIREBASE_URL}/${path}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (e) { log.error("Post data fail"); }
}

// --- BOT MAIN ENGINE ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.clear();
            console.log(chalk.blue.bold('\n ——————————————————————————————————————————————'));
            console.log(chalk.white.bold('   🚀 DIGITAL ZONE AGENT BOT IS NOW ONLINE!'));
            console.log(chalk.blue.bold(' ——————————————————————————————————————————————\n'));
            log.success("Connected to WhatsApp Successfully.");
        }
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                log.info("Reconnecting...");
                startBot();
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        
        log.msg(jid.split('@')[0], text);

        // --- GREETING & RESET ---
        if (text === 'hi' || text === 'menu' || text === 'm' || !userState[jid]) {
            userState[jid] = { step: 'MAIN_MENU' };
        }

        const state = userState[jid];

        // --- BACK BUTTON LOGIC ---
        if (text === 'b') {
            if (state.step === 'SELECT_NETWORK' || state.step === 'VIEW_TOOLS') state.step = 'MAIN_MENU';
            else if (state.step === 'SHOW_PACKAGES') state.step = 'SELECT_NETWORK';
            else if (state.step === 'CONFIRM_ORDER') state.step = 'SHOW_PACKAGES';
            
            // Back janay ke baad menu dobara dikhana
            if (state.step === 'MAIN_MENU') {
                return await sock.sendMessage(jid, { text: "👋 *Assalam Alaikum!*\n\nWelcome back to *Digital Zone*\nHow can I help you today?\n\n1️⃣ *Sim Packages*\n2️⃣ *Digital Tools*\n\n_Reply with 1 or 2_" });
            }
        }

        // --- FLOW CONTROL ---
        switch (state.step) {
            case 'MAIN_MENU':
                await sock.sendMessage(jid, { 
                    text: `👋 *Assalam Alaikum!*

✨ Welcome to *Digital Zone* ✨
Your premium destination for Digital Services.

1️⃣ *Sim Packages* (Telenor/Zong)
2️⃣ *Tools & Software*

Please reply with the *Number* of your choice.`
                });
                state.step = 'CATEGORY_SELECTION';
                break;

            case 'CATEGORY_SELECTION':
                if (text === '1') {
                    state.step = 'SELECT_NETWORK';
                    await sock.sendMessage(jid, { 
                        text: `📶 *Network Selection*

Please choose your network:
🅣 *Telenor*
🅩 *Zong*

_Type *T* or *Z*_
🔙 *B* = Back` 
                    });
                } else if (text === '2') {
                    state.step = 'VIEW_TOOLS';
                    const tools = await fetchData('tools');
                    let tMsg = "🛠 *Digital Zone Tools*\n\n";
                    if(tools) Object.values(tools).forEach((t, i) => tMsg += `🔹 ${i+1}. *${t.name}*\n`);
                    else tMsg += "No tools available right now.";
                    tMsg += "\n🔙 Type *B* to go back";
                    await sock.sendMessage(jid, { text: tMsg });
                }
                break;

            case 'SELECT_NETWORK':
                if (['t', 'z'].includes(text)) {
                    const net = text === 't' ? 'telenor' : 'zong';
                    const pkgs = await fetchData(`sim_packages/${net}`);
                    state.network = net;
                    state.tempData = pkgs;
                    state.step = 'SHOW_PACKAGES';
                    
                    let pMsg = `📡 *${net.toUpperCase()} SPECIAL OFFERS*\n\n`;
                    if(pkgs) {
                        Object.values(pkgs).forEach((p, i) => pMsg += `*${i+1}* ➔ ${p.name}\n💰 Price: *PKR ${p.price}*\n\n`);
                        pMsg += "Reply with the *Package Number* to buy.\n🔙 *B* = Back";
                    } else {
                        pMsg = "⚠️ No packages found for this network.";
                    }
                    await sock.sendMessage(jid, { text: pMsg });
                }
                break;

            case 'SHOW_PACKAGES':
                const idx = parseInt(text) - 1;
                const items = Object.values(state.tempData || {});
                if (items[idx]) {
                    state.step = 'CONFIRM_ORDER';
                    state.selectedItem = items[idx];
                    await sock.sendMessage(jid, { 
                        text: `🛒 *Order Summary*

📦 Item: *${items[idx].name}*
💰 Price: *PKR ${items[idx].price}*

──────────────────
Please enter the *Mobile Number* where you want this package:
🔙 *B* = Back` 
                    });
                }
                break;

            case 'CONFIRM_ORDER':
                // Check if text is a valid number (simple check)
                if (text.length >= 10) {
                    const order = {
                        number: text,
                        item: state.selectedItem.name,
                        price: state.selectedItem.price,
                        status: "Pending",
                        time: new Date().toLocaleString()
                    };
                    await postData('orders', order);
                    await sock.sendMessage(jid, { 
                        text: `✅ *ORDER PLACED!*

Your order for *${state.selectedItem.name}* on number *${text}* has been received. 

🚀 We will process it within 15-30 minutes. 
Thank you for choosing *Digital Zone*!` 
                    });
                    delete userState[jid]; // Order complete, reset user
                } else {
                    await sock.sendMessage(jid, { text: "❌ Invalid Number! Please enter a valid 11-digit mobile number." });
                }
                break;
        }
    });
}

// Start the Magic
startBot();
