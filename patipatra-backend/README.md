# পাটিপত্র Patipatra — Backend

Booking, live admin alerts, gallery and reviews for the Patipatra website.
**No `npm install` needed** — it uses only what comes with Node.js.

## What it does

| For the customer | For the organiser (Mr. Amit Roy) |
|---|---|
| `/booking` — tap as many items as they like (Kalka, Gachkouto, Paan Pata, Boron & Khai Daan, Kulo, Biyer Piri, Matir Thala, Mehendi, Resin Memories, Artistic Panjabi, **Totto**, **Anything else**) | `/admin` — password-protected panel |
| **Confirm booking** → sees the **50% advance** message + two buttons: **Call 9831090796** and **WhatsApp** | **Instant alert** the moment someone confirms (pop-up, sound, browser notification, optional Telegram) |
| `/gallery` — limited photos and videos, with a lightbox | Manage bookings: status, private notes, call / WhatsApp the customer |
| `/review/<private link>` — opens up **after the order is delivered** | Manage items, photos/videos (upload), reviews (approve before they show), settings |

Payments are **not** taken online. Customers pay the 50% advance directly after speaking with the organiser.

## 1. Run it on your computer

1. Install **Node.js 22.13 or newer** (https://nodejs.org).
2. Open a terminal in this folder and run:
   ```
   copy .env.example .env        (Windows)      cp .env.example .env     (Mac/Linux)
   ```
3. Open `.env` and change at least `ADMIN_PASSWORD` and `SESSION_SECRET`.
4. Start it:
   ```
   npm start
   ```
5. Open  http://localhost:3000/booking  ·  http://localhost:3000/gallery  ·  http://localhost:3000/admin

Run the automated checks any time with `npm test` (36 tests).

## 2. How the booking → review journey works

1. Customer selects items on `/booking` → **Confirm booking** → fills name, mobile, date, city, message.
2. The server saves it, and the admin panel pops up **"New booking PP-2610-XXXX"** (plus sound/Telegram).
3. Customer sees: *"To confirm your booking you have to pay 50% in advance…"* with **Call** and **WhatsApp** buttons (the WhatsApp message is pre-filled with their booking ID and items) and **their private review link**.
4. Organiser talks to them, then moves the booking along: *New → Contacted → Confirmed → Advance received → In progress → Delivered → Completed*.
5. When you set **Delivered**, a green **"Ask on WhatsApp"** button appears inside that booking. One tap opens WhatsApp with a ready message and the review link.
6. The customer opens the link, taps the stars, writes a comment. Before delivery the page politely says "you can review once you receive your order".
7. You get an alert for the new review; **Reviews → Show on website** publishes it on `/gallery`.

> WhatsApp messages are sent *by you* with one tap (the button opens WhatsApp). Sending them fully automatically needs the paid WhatsApp Business API — this backend does not require it.

## 3. Alerts

* **While the admin page is open** (any phone/PC browser): pop-up, sound, tab title `(1) Patipatra Admin`, and a system notification. Click **Turn on sound alerts** once after opening the page.
* **Even when the page is closed — Telegram (free, recommended):**
  1. In Telegram, chat with **@BotFather**, send `/newbot`, copy the token.
  2. Send any message to your new bot.
  3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the number after `"chat":{"id":`.
  4. Put both in `.env` as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, restart.
* `WEBHOOK_URL` (optional) posts JSON to Zapier / Make / n8n.

## 4. Putting it online

Any host that runs Node 22 works (Render, Railway, a VPS). Important points:

* **Use a persistent disk / volume** and point `DATA_DIR` and `UPLOAD_DIR` at it — otherwise bookings and photos vanish when the server restarts. (Free plans without a disk will lose data.)
* Set `NODE_ENV=production`, `TRUST_PROXY=true`, and `PUBLIC_BASE_URL=https://your-domain` (used in review links).
* Start command: `npm start`.
* **Back up the `data` and `uploads` folders regularly.**

## 5. Connecting to your React / Vite design

The pages above are served by this backend, so the simplest connection is links. In your design (`App.tsx`) point the buttons to the backend:

```tsx
const BACKEND = import.meta.env.VITE_BACKEND_URL; // e.g. https://patipatra.onrender.com

<a href={`${BACKEND}/booking`}>Plan with us</a>
<a href={`${BACKEND}/booking?service=kulo,kalka`}>Book these</a>   // pre-selects items by slug
<a href={`${BACKEND}/gallery`}>Gallery</a>
```

Item slugs: `kalka, gachkouto, pan-pata, boron-khai-daan, kulo, biyer-piri, matir-thala, mehendi, resin-memories, artistic-panjabi, totto, custom`.

If you would rather build the booking screen *inside* the React app, call the API directly and add your site's address to `ALLOWED_ORIGINS`. The pages in `public/assets/*.js` are a complete working example of every call.

## 6. Everyday admin tasks

* **Replace the sample photos** — Gallery tab: delete the "Sample photo" items and upload your own photos/videos (photos ≤ 15 MB, videos ≤ 150 MB).
* **Add a photo for Totto** — Items & collections tab → Totto → upload.
* **Change phone number / advance % / messages** — Settings tab.
* **Add new services** — Items & collections → "Add a new item" (shows immediately on `/booking`).

## 7. API reference (short)

Public: `GET /api/health · /api/settings · /api/services · /api/gallery · /api/reviews`
`POST /api/bookings` `{name, phone, service_ids:[…], event_date?, city?, email?, message?}`
`GET|POST /api/review/:token`
Admin (cookie login): `/api/admin/login · logout · me · stream · stats · notifications · bookings · services · gallery · upload · reviews · settings`

## 8. Safety built in

Server-side validation of everything; spam protection (hidden trap field, per-IP and per-phone limits); login attempt limits; signed HttpOnly session cookie; same-site request checks; uploads checked by file type *and* real file signature, with size limits; no path traversal; strict Content-Security-Policy; customer text is always displayed as plain text (no script injection).

## Folder map

```
server.js            start here
src/                 app, database, API routes, admin routes, alerts
public/              booking.html, gallery.html, review.html, admin/, assets/
data/                database file (created automatically)
uploads/             photos and videos you upload
test/                automated tests
```
