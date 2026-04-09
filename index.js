const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');
const chalk = require('chalk');

const FIREBASE_URL = process.env.FIREBASE_URL; 
const userState = {};

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
        const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (e) { log.error("Post data fail"); return null; }
}

async function updateData(path, data) {
    try {
        await fetch(`${FIREBASE_URL}/${path}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (e) { log.error("Update data fail"); }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
    });

    // --- AUTO NOTIFICATION LOGIC (Approve/Reject) ---
    // Ye hissa database mein tabdeeli check karta rahega
    setInterval(async () => {
        const orders = await fetchData('orders');
        if (orders) {
            for (const key in orders) {
                const order = orders[key];
                if (!order.notified && (order.status === "Completed" || order.status === "Rejected")) {
                    let noteMsg = "";
                    if (order.status === "Completed") {
                        noteMsg = `🎉 *GOOD NEWS!* \n\nYour order for *${order.item}* has been successfully activated. Enjoy your services! 🔥\n\nThank you for choosing *Digital Zone*!`;
                    } else if (order.status === "Rejected") {
                        noteMsg = `❌ *ORDER REJECTED* \n\nYour order for *${order.item}* has been rejected because your TID/Details were incorrect.\n\nPlease check and try again with valid payment proof.\n\n_Digital Zone Support_`;
                    }

                    if (noteMsg && order.user_jid) {
                        try {
                            await sock.sendMessage(order.user_jid, { text: noteMsg });
                            await updateData(`orders/${key}`, { notified: true });
                            log.success(`Notification sent to ${order.user_jid}`);
                        } catch (err) { log.error("Failed to send notification"); }
                    }
                }
            }
        }
    }, 5000); // Har 5 second baad check karega

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.clear();
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
            return await sock.sendMessage(jid, { text: "👋 *Digital Zone* se rabta karne ka shukria. Allah Hafiz!\n\n*Type 'Hi' to start again*" });
        }

        if (!userState[jid]) return;
        const u = userState[jid];

        if (text === 'b') {
            if (u.step === 'CATEGORY_SELECTION' || u.step === 'SELECT_NETWORK' || u.step === 'VIEW_TOOLS') {
                u.step = 'MAIN_MENU';
            } else if (u.step === 'SHOW_PACKAGES') {
                u.step = 'SELECT_NETWORK'; 
            } else if (u.step === 'PAYMENT_INFO') {
                u.step = 'SHOW_PACKAGES';
            } else if (u.step === 'SUBMIT_DETAILS') {
                u.step = 'PAYMENT_INFO';
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
                u.tempData = tools;
                let tMsg = "🛠 *Digital Zone Tools*\n\n";
                if(tools) {
                    Object.values(tools).forEach((t, i) => {
                        tMsg += `*${i+1}* ➔ *${t.name}*\n💰 Price: PKR ${t.discount}\n⏳ Subs: ${t.subs}\n📝 Info: ${t.info}\n\n`;
                    });
                    tMsg += "_Reply with Number to Buy_";
                } else tMsg += "⚠️ No tools available.";
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
                    Object.values(pkgs).forEach((p, i) => {
                        pMsg += `*${i+1}* ➔ *${p.name}*\n🌐 Data: ${p.mbs}\n📞 Off-Net: ${p.off_net}\n☎️ On-Net: ${p.on_net}\n💬 SMS: ${p.sms}\n📅 Validity: ${p.validity}\n💰 Price: PKR ${p.discount_price}\n\n`;
                    });
                    pMsg += "Reply with *Number* to Buy.";
                } else pMsg = "⚠️ No packages found.";
                await sock.sendMessage(jid, { text: pMsg + footer });
            }
        }
        else if (u.step === 'SHOW_PACKAGES' || u.step === 'VIEW_TOOLS') {
            const idx = parseInt(text) - 1;
            const items = Object.values(u.tempData || {});
            if (items[idx]) {
                u.selectedItem = items[idx];
                u.step = 'PAYMENT_INFO';
                const finalPrice = u.selectedItem.discount_price || u.selectedItem.discount;
                
                let payMsg = `🛒 *Selected:* ${u.selectedItem.name}\n💰 *Price:* PKR ${finalPrice}\n\n──────────────────\n*Type Y to proceed your order*` + footer;
                
                if (u.selectedItem.image) {
                    await sock.sendMessage(jid, { image: { url: u.selectedItem.image }, caption: payMsg });
                } else {
                    await sock.sendMessage(jid, { text: payMsg });
                }
            }
        }
        else if (u.step === 'PAYMENT_INFO') {
            if (text === 'y') {
                u.step = 'SUBMIT_DETAILS';
                const finalPrice = u.selectedItem.discount_price || u.selectedItem.discount;
                await sock.sendMessage(jid, { 
                    text: `💳 *Payment Method*\n\nPlease send *RS. ${finalPrice}* to:\n\n📌 *Jazzcash*\n👤 Name: *Abadullah*\n📱 No: *03169645057*\n\n──────────────────\nAfter payment, type your *Mobile Number* and *TID* to confirm order.`
                });
            }
        }
        else if (u.step === 'SUBMIT_DETAILS') {
            if (text.length > 5 && !['b','m','e'].includes(text)) {
                const finalPrice = u.selectedItem.discount_price || u.selectedItem.discount;
                const order = {
                    user_jid: jid, // Zaroori Line: Notification ke liye
                    number_tid: text,
                    item: u.selectedItem.name,
                    price: finalPrice,
                    status: "Pending",
                    notified: false,
                    time: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
                };
                
                await postData('orders', order);
                
                let summaryMsg = `✅ *ORDER PLACED SUCCESSFULLY!*\n\n` +
                                 `📦 *Item:* ${u.selectedItem.name}\n` +
                                 `💰 *Amount:* PKR ${finalPrice}\n` +
                                 `📝 *Details:* ${text}\n` +
                                 `⏳ *Status:* Pending\n\n` +
                                 `──────────────────\n` +
                                 `Your package will be activated in a short while. Thank you for choosing *Digital Zone*!`;
                
                await sock.sendMessage(jid, { text: summaryMsg });
                delete userState[jid];
            }
        }
    });
}

startBot();
