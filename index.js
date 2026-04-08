const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');
const chalk = require('chalk');

const FIREBASE_URL = process.env.FIREBASE_URL; 
const userState = {};

// Dono options enable kar diye hain
const usePairingCode = true; 
const phoneNumber = process.env.PHONE || "923XXXXXXXXX"; // GitHub Secrets mein PHONE save rakhen

const log = {
    info: (msg) => console.log(chalk.cyan.bold(' [INFO] ') + chalk.white(msg)),
    success: (msg) => console.log(chalk.green.bold(' [SUCCESS] ') + chalk.white(msg)),
    error: (msg) => console.log(chalk.red.bold(' [ERROR] ') + chalk.white(msg)),
    msg: (from, text) => console.log(chalk.yellow.bold(` 📩 Msg: `) + chalk.white(`${from} -> ${text}`))
};

async function fetchData(path) {
    try {
        const res = await fetch(`${FIREBASE_URL}/${path}.json`);
        return await res.json();
    } catch (e) { return null; }
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

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true, // QR Code hamesha print hoga
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
    });

    // --- DOUBLE LINKING SYSTEM (QR + PAIRING) ---
    if (!sock.authState.creds.registered) {
        if (usePairingCode) {
            console.log(chalk.yellow.bold("\n--- DIGITAL ZONE PAIRING SYSTEM ---"));
            await delay(5000); // Wait for connection
            try {
                const code = await sock.requestPairingCode(phoneNumber.trim());
                console.log(chalk.green.bold(`\n🔥 PAIRING CODE: `) + chalk.white.bgGreen.bold(` ${code} `));
                console.log(chalk.gray("Ya phir upar wala QR scan karen...\n"));
            } catch (err) {
                log.error("Pairing Code failed, use QR instead.");
            }
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // QR manual handle karne ke liye (agar printQRInTerminal issue kare)
        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            log.success("Connected to WhatsApp Successfully.");
        }
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        
        log.msg(jid.split('@')[0], text);

        const footer = "\n\n──────────────────\n🔙 *B* = Back | 🏠 *M* = Menu | 🚪 *E* = Exit";

        if (text === 'm' || text === 'menu' || text === 'hi') {
            userState[jid] = { step: 'MAIN_MENU' };
        } else if (text === 'e') {
            delete userState[jid];
            return await sock.sendMessage(jid, { text: "👋 *Digital Zone* se rabta karne ka shukria. Allah Hafiz!" });
        }

        if (!userState[jid]) userState[jid] = { step: 'MAIN_MENU' };
        const u = userState[jid];

        if (text === 'b') {
            if (u.step === 'CATEGORY_SELECTION' || u.step === 'SELECT_NETWORK' || u.step === 'VIEW_TOOLS') {
                u.step = 'MAIN_MENU';
            } else if (u.step === 'SHOW_PACKAGES') {
                u.step = 'CATEGORY_SELECTION'; 
            } else if (u.step === 'CONFIRM_ORDER') {
                u.step = 'SHOW_PACKAGES';
            }
        }

        if (u.step === 'MAIN_MENU' || (text === 'b' && u.step === 'MAIN_MENU')) {
            await sock.sendMessage(jid, { 
                text: `👋 *Assalam Alaikum!*\n\n✨ Welcome to *Digital Zone* ✨\n1️⃣ *Sim Packages*\n2️⃣ *Digital Tools*\n\n_Reply with 1 or 2_` + footer
            });
            u.step = 'CATEGORY_SELECTION';
        } 
        else if (u.step === 'CATEGORY_SELECTION') {
            if (text === '1' || (text === 'b' && u.step === 'CATEGORY_SELECTION')) {
                u.step = 'SELECT_NETWORK';
                await sock.sendMessage(jid, { 
                    text: `📶 *Network Selection*\n\n🅣 *Telenor*\n🅩 *Zong*\n\n_Reply with *T* or *Z*_` + footer
                });
            } else if (text === '2') {
                u.step = 'VIEW_TOOLS';
                const tools = await fetchData('tools');
                let tMsg = "🛠 *Digital Zone Tools*\n\n";
                if(tools) Object.values(tools).forEach((t, i) => tMsg += `🔹 ${i+1}. *${t.name}*\n💰 PKR ${t.discount}\n⏳ ${t.subs}\n\n`);
                else tMsg += "⚠️ No tools available.";
                await sock.sendMessage(jid, { text: tMsg + footer });
            }
        }
        else if (u.step === 'SELECT_NETWORK') {
            if (['t', 'z'].includes(text)) {
                const net = text === 't' ? 'telenor' : 'zong';
                const pkgs = await fetchData(`sim_packages/${net}`);
                u.network = net;
                u.tempData = pkgs;
                u.step = 'SHOW_PACKAGES';
                
                let pMsg = `📡 *${net.toUpperCase()} SPECIAL OFFERS*\n\n`;
                if(pkgs && Object.keys(pkgs).length > 0) {
                    Object.values(pkgs).forEach((p, i) => pMsg += `*${i+1}* ➔ ${p.name}\n💰 PKR ${p.price}\n\n`);
                    pMsg += "Reply with *Number* to buy.";
                } else pMsg = "⚠️ No packages found.";
                await sock.sendMessage(jid, { text: pMsg + footer });
            }
        }
        else if (u.step === 'SHOW_PACKAGES') {
            if (text === 'b') { 
                 u.step = 'SELECT_NETWORK';
                 return await sock.sendMessage(jid, { text: `📶 *Network Selection*\n\n🅣 *Telenor*\n🅩 *Zong*` + footer });
            }
            const idx = parseInt(text) - 1;
            const items = Object.values(u.tempData || {});
            if (items[idx]) {
                u.step = 'CONFIRM_ORDER';
                u.selectedItem = items[idx];
                await sock.sendMessage(jid, { 
                    text: `🛒 *Order Summary*\n📦 *${items[idx].name}*\n💰 *PKR ${items[idx].price}*\n\n──────────────────\nPlease enter the *Mobile Number*: ` + footer 
                });
            }
        }
        else if (u.step === 'CONFIRM_ORDER') {
            if (text.length >= 10 && !['b','m','e'].includes(text)) {
                const order = {
                    number: text,
                    item: u.selectedItem.name,
                    price: u.selectedItem.price,
                    status: "Pending",
                    time: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
                };
                await postData('orders', order);
                await sock.sendMessage(jid, { text: `✅ *ORDER PLACED!*\n\nPackage: *${u.selectedItem.name}*\nNumber: *${text}*\n\nWe will process it shortly!` });
                delete userState[jid];
            }
        }
    });
}

startBot();
