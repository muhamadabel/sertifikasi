# Backend Pembayaran (QR Manual via Telegram)

Perantara antara web dan bot Telegram. Token bot **hanya** ada di sini, tidak pernah sampai ke browser.

## Alur

1. User klik bayar di web → web `POST /create` → bot **DM kamu** di Telegram.
2. Kamu **balas (reply)** pesan order itu dengan **foto QR** → web otomatis menampilkannya.
3. User scan & bayar → kamu klik tombol **✅ Tandai Lunas** → web user jadi "terverifikasi".

## Persiapan (sekali saja)

1. **Buat bot**: chat [@BotFather](https://t.me/BotFather) → `/newbot` → salin **BOT_TOKEN**.
2. **Ambil chat id kamu**: kirim pesan apa saja ke bot kamu, lalu buka di browser
   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates` → cari `"chat":{"id": ...}`.
   (Alternatif: chat [@userinfobot](https://t.me/userinfobot).) Itu **ADMIN_CHAT_ID**.
3. Pastikan **Node.js v18+** terpasang (`node -v`).
4. Di folder `server/`, jalankan: `npm install`.

## Menjalankan (lokal)

PowerShell (Windows):

```powershell
$env:BOT_TOKEN="ISI_TOKEN"; $env:ADMIN_CHAT_ID="ISI_CHAT_ID"; npm start
```

Lalu di `index.html`, ubah:

```js
const PAYMENT_API = {
    base: 'http://localhost:3000',   // <- isi ini (kosongkan lagi untuk mode contoh)
    ...
};
```

Buka web, klik daftar → kamu akan dapat notifikasi di Telegram. Balas dengan foto QR.

## Deploy (opsional, agar bisa diakses publik)

Cocok di **Railway** / **Render** (gratis untuk skala kecil):

- Upload folder `server/` sebagai service Node.
- Set environment variable: `BOT_TOKEN`, `ADMIN_CHAT_ID`, dan
  `ALLOW_ORIGIN` = origin web kamu (mis. `https://namamu.github.io`).
- Setelah dapat URL publik (mis. `https://xxx.up.railway.app`), isi URL itu ke
  `PAYMENT_API.base` di `index.html`.

## Catatan

- Data order disimpan **di memori** — hilang kalau server restart. Cukup untuk skala
  kecil/manual. Kalau nanti butuh permanen, bisa ditambah database (SQLite/Redis).
- `EXPIRE_MIN` (15 menit) di `bot-server.js` sebaiknya sama dengan `timeoutMin` di web.
