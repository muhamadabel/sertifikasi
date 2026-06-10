// =============================================================================
// Backend perantara: web  <->  bot Telegram  (alur QR MANUAL)
// -----------------------------------------------------------------------------
// Alur:
//   1. Web POST /create  -> backend DM kamu di Telegram (ada tombol & instruksi).
//   2. Kamu BALAS (reply) notif itu dengan FOTO QR -> backend simpan (qrReady).
//   3. Web polling /status -> dapat qrReady -> tampilkan QR (di-proxy via /qr).
//   4. User bayar, kamu klik tombol "Tandai Lunas" -> status = 'paid'.
//
// Token bot HANYA ada di sini (server), tidak pernah sampai ke browser.
// Butuh Node.js v18+ (memakai fetch bawaan).
// =============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// ---- Konfigurasi (isi lewat environment variable, lihat README) ----
const BOT_TOKEN     = process.env.BOT_TOKEN;            // dari @BotFather
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;        // chat id Telegram kamu
const PORT          = process.env.PORT || 3000;
const ALLOW_ORIGIN  = process.env.ALLOW_ORIGIN || '*';  // origin web kamu (mis. https://namamu.github.io)
const EXPIRE_MIN    = 15;                                // batas waktu bayar (samakan dgn web)

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.error('BOT_TOKEN dan ADMIN_CHAT_ID wajib diisi. Lihat README.md.');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
app.use(cors({ origin: ALLOW_ORIGIN }));
app.use(express.json());

// Sajikan halaman web (FE) dari backend ini juga → cukup buka http://localhost:3000
// (hanya index.html yang disajikan; folder server/ & .env TIDAK ikut terbuka)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

// ---- Penyimpanan order (in-memory; reset saat server restart) ----
const orders = new Map();      // orderId -> { status, qrFileId, name, nim, amount, notifMsgId, timer }
const msgToOrder = new Map();  // message_id notif -> orderId (untuk mencocokkan balasan foto)

const rupiah = n => 'Rp' + Number(n).toLocaleString('id-ID');

// ============================ ENDPOINT UNTUK WEB =============================

// 1) Web bikin order -> kirim notifikasi ke admin
app.post('/create', async (req, res) => {
    const { orderId, name, nim, amount } = req.body || {};
    if (!orderId || !name || !amount) return res.status(400).json({ error: 'data kurang' });
    if (orders.has(orderId)) return res.json({ ok: true }); // idempotent

    const order = { status: 'pending', qrFileId: null, name, nim, amount, notifMsgId: null, timer: null };
    orders.set(orderId, order);
    console.log('[create]', orderId, '-', name, rupiah(amount));

    const text =
        '🧾 *Order pembayaran baru*\n\n' +
        '👤 ' + name + '\n' +
        '🆔 NIM: ' + (nim || '-') + '\n' +
        '💰 ' + rupiah(amount) + '\n' +
        '🔖 Order: `' + orderId + '`\n\n' +
        '➡️ *Balas pesan ini dengan FOTO QR* untuk dikirim ke pembeli.';

    try {
        const msg = await bot.sendMessage(ADMIN_CHAT_ID, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                { text: '✅ Tandai Lunas', callback_data: 'paid:' + orderId },
                { text: '❌ Batalkan',     callback_data: 'cancel:' + orderId },
            ]] },
        });
        order.notifMsgId = msg.message_id;
        msgToOrder.set(msg.message_id, orderId);

        // auto-expire kalau tidak lunas dalam batas waktu
        order.timer = setTimeout(() => {
            const o = orders.get(orderId);
            if (o && o.status === 'pending') o.status = 'expired';
        }, EXPIRE_MIN * 60 * 1000);

        res.json({ ok: true });
    } catch (e) {
        console.error('Gagal kirim ke Telegram:', e.message);
        res.status(500).json({ error: 'gagal kirim notifikasi' });
    }
});

// 2) Web cek status order
app.get('/status', (req, res) => {
    const o = orders.get(req.query.orderId);
    if (!o) return res.json({ status: 'expired', qrReady: false });
    res.json({ status: o.status, qrReady: !!o.qrFileId });
});

// 3) Web ambil gambar QR (di-proxy; token tidak bocor ke browser)
app.get('/qr', async (req, res) => {
    const o = orders.get(req.query.orderId);
    if (!o || !o.qrFileId) return res.status(404).send('QR belum tersedia');
    try {
        const link = await bot.getFileLink(o.qrFileId);   // URL berisi token -> server-side saja
        const r = await fetch(link);
        const buf = Buffer.from(await r.arrayBuffer());
        res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
        res.set('Cache-Control', 'no-store');
        res.send(buf);
    } catch (e) {
        res.status(500).send('gagal mengambil QR');
    }
});

// ============================ HANDLER TELEGRAM ==============================

// Admin membalas notifikasi order dengan FOTO QR
bot.on('photo', (msg) => {
    const replyTo = msg.reply_to_message;
    if (!replyTo || !msgToOrder.has(replyTo.message_id)) {
        return bot.sendMessage(msg.chat.id, 'ℹ️ Kirim QR dengan cara *membalas* (reply) pesan order yang sesuai.', { parse_mode: 'Markdown' });
    }
    const orderId = msgToOrder.get(replyTo.message_id);
    const o = orders.get(orderId);
    if (!o) return;
    o.qrFileId = msg.photo[msg.photo.length - 1].file_id; // ambil resolusi terbesar
    console.log('[photo] QR diterima untuk', orderId);
    bot.sendMessage(msg.chat.id, '✅ QR untuk order `' + orderId + '` terkirim ke pembeli.', { parse_mode: 'Markdown' });
});

// Admin menekan tombol Lunas / Batal
bot.on('callback_query', (q) => {
    const [action, orderId] = (q.data || '').split(':');
    console.log('[callback]', action, orderId);
    const o = orders.get(orderId);
    if (!o) return bot.answerCallbackQuery(q.id, { text: 'Order tidak ditemukan / sudah kedaluwarsa.' });

    if (action === 'paid')   { o.status = 'paid';    if (o.timer) clearTimeout(o.timer); bot.answerCallbackQuery(q.id, { text: '✅ Ditandai lunas.' }); }
    if (action === 'cancel') { o.status = 'expired'; if (o.timer) clearTimeout(o.timer); bot.answerCallbackQuery(q.id, { text: '❌ Dibatalkan.' }); }
});

bot.on('polling_error', (e) => console.error('Polling error:', e.message));

app.listen(PORT, () => console.log('✅ Backend jalan di http://localhost:' + PORT));
