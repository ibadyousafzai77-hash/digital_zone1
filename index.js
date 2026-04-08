const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');
const chalk = require('chalk');

// --- CONFIGURATION ---
const FIREBASE_URL = process.env.FIREBASE_URL; 
const userState = {};

// --- STYLISH CONSOLE LOGS ---
const log = {
    info: (msg) => console.log(chalk.cyan.bold(' [INFO] ') + chalk.white(msg)),
    success: (msg) => console.log(chalk.green.bold(' [SUCCESS] ') + chalk.white(msg)),
    error: (msg) => console.log(chalk.red.bold(' [ERROR] ') + chalk.white(msg)),
    msg: (from, text) => console.log(chalk.yellow.bold(` 📩 Msg: `) + chalk.white(`${from} -> ${text}`))
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

        // --- UNIVERSAL CONTROLS ---
        if (text === 'm' || text === 'menu' || text === 'hi') {
            userState[jid] = { step: 'MAIN_MENU' };
        } else if (text === 'e') {
            delete userState[jid];
            return await sock.sendMessage(jid, { text: "👋 *Digital Zone* se rabta karne ka shukria. Allah Hafiz!\n\n_Type 'hi' to start again._" });
        }

        if (!userState[jid]) userState[jid] = { step: 'MAIN_MENU' };
        const state = userState[jid];

        // --- UNIVERSAL FOOTER ---
        const footer = "\n\n──────────────────\n🔙 *B* = Back | 🏠 *M* = Menu | 🚪 *E* = Exit";

        // --- BACK LOGIC ---
        if (text === 'b') {
            if (state.step === 'CATEGORY_SELECTION' || state.step === 'SELECT_NETWORK' || state.step === 'VIEW_TOOLS') {
                state.step = 'MAIN_MENU';
            } else if (state.step === 'SHOW_PACKAGES') {
                state.step = 'SELECT_NETWORK';
            } else if (state.step === 'CONFIRM_ORDER') {
                state.step = 'SHOW_PACKAGES';
            }
            
            // Foran menu dikhane ke liye agar back dabba diya
            if (state.step === 'MAIN_MENU') {
                return await sock.sendMessage(jid, { 
                    text: `👋 *Assalam Alaikum!*

✨ Welcome back to *Digital Zone* ✨
Premium Digital Services at your doorstep.

1️⃣ *Sim Packages* (Telenor/Zong)
2️⃣ *Digital Tools*

_Please reply with 1 or 2_` + footer
                });
            }
        }

        // --- FLOW CONTROL ---
        switch (state.step) {
            case 'MAIN_MENU':
                await sock.sendMessage(jid, { 
                    text: `👋 *Assalam Alaikum!*

✨ Welcome to *Digital Zone* ✨
Premium Digital Services at your doorstep.

1️⃣ *Sim Packages* (Telenor/Zong)
2️⃣ *Digital Tools*

_Please reply with 1 or 2_` + footer
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

_Reply with *T* or *Z*_` + footer
                    });
                } else if (text === '2') {
                    state.step = 'VIEW_TOOLS';
                    const tools = await fetchData('tools');
                    let tMsg = "🛠 *Digital Zone Tools*\n\n";
                    if(tools) {
                        Object.values(tools).forEach((t, i) => tMsg += `🔹 ${i+1}. *${t.name}*\n`);
                    } else {
                        tMsg += "⚠️ No tools available right now.";
                    }
                    await sock.sendMessage(jid, { text: tMsg + footer });
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
                    if(pkgs && Object.keys(pkgs).length > 0) {
                        Object.values(pkgs).forEach((p, i) => pMsg += `*${i+1}* ➔ ${p.name}\n💰 Price: *PKR ${p.price}*\n\n`);
                        pMsg += "Reply with *Package Number* to buy.";
                    } else {
                        pMsg = "⚠️ No packages found for this network. Please add packages from Admin Panel.";
                    }
                    await sock.sendMessage(jid, { text: pMsg + footer });
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
Please enter the *Mobile Number* for this package:` + footer 
                    });
                }
                break;

            case 'CONFIRM_ORDER':
                // Check if it's a number and not a control command
                if (text.length >= 10 && !['b','m','e'].includes(text)) {
                    const order = {
                        number: text,
                        item: state.selectedItem.name,
                        price: state.selectedItem.price,
                        status: "Pending",
                        time: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
                    };
                    await postData('orders', order);
                    await sock.sendMessage(jid, { 
                        text: `✅ *ORDER PLACED!*

Your order for *${state.selectedItem.name}* on number *${text}* has been received. 

🚀 We will process it shortly. 
Thank you for choosing *Digital Zone*!` 
                    });
                    delete userState[jid]; // Reset
                }
                break;
        }
    });
}

startBot();
