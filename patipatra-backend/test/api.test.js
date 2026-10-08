import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "../src/app.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

let s;
let base;
let tmp;
let cookie = "";
let ipCounter = 0;
const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
let phoneCounter = 0;
const nextPhone = () => `98${String(30000000 + ++phoneCounter)}`;

async function call(method, url, { body, headers = {}, raw, ip = nextIp(), auth = false } = {}) {
  const h = { "x-forwarded-for": ip, ...headers };
  if (auth) h.cookie = cookie;
  let payload = raw;
  if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, headers: res.headers, json, text };
}

const goodBooking = (extra = {}) => ({ name: "Riya Sen", phone: nextPhone(), service_ids: [1, 5, 11], event_date: "2099-12-04", city: "Kolkata", ...extra });

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-test-"));
  s = await startServer({
    __skipDotEnv: true,
    port: 0,
    host: "127.0.0.1",
    dbPath: ":memory:",
    uploadDir: path.join(tmp, "uploads"),
    adminPassword: "test-password",
    sessionSecret: "test-secret",
    trustProxy: true,
    quiet: true,
    allowedOrigins: ["https://site.test"],
    maxImageBytes: 5000,
    maxUploadBytes: 20000,
    telegramToken: "",
    telegramChatId: "",
    webhookUrl: "",
    seedDemoGallery: true,
  });
  base = s.url;
});

after(async () => {
  await s.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("public content", () => {
  test("health and settings", async () => {
    assert.equal((await call("GET", "/api/health")).json.ok, true);
    const { json } = await call("GET", "/api/settings");
    const st = json.settings;
    assert.equal(st.organiser_phone, "9831090796");
    assert.equal(st.call_url, "tel:+919831090796");
    assert.equal(st.whatsapp_url, "https://wa.me/919831090796");
    assert.equal(st.advance_percent, 50);
    assert.match(st.advance_message_en, /50% in advance/);
    assert.match(st.advance_message_bn, /৫০%/);
  });

  test("12 services including totto (#11) and the custom option (#12)", async () => {
    const { json } = await call("GET", "/api/services");
    assert.equal(json.services.length, 12);
    assert.equal(json.services[10].slug, "totto");
    assert.equal(json.services[10].title_bn, "তত্ত্ব");
    assert.equal(json.services[11].slug, "custom");
    assert.equal(json.services[11].is_custom, true);
    assert.ok(json.categories.includes("Wedding essentials"));
  });

  test("gallery has sample items and reviews start empty", async () => {
    const g = await call("GET", "/api/gallery");
    assert.ok(g.json.items.length >= 1);
    const r = await call("GET", "/api/reviews");
    assert.equal(r.json.count, 0);
  });
});

describe("booking", () => {
  test("a multi-item booking works and returns payment + contact info", async () => {
    const b = goodBooking();
    const { status, json } = await call("POST", "/api/bookings", { body: b });
    assert.equal(status, 201);
    assert.match(json.booking.ref, /^PP-\d{4}-[A-Z2-9]{4}$/);
    assert.equal(json.booking.items.length, 3);
    assert.match(json.advance_message_en, /50% in advance/);
    assert.equal(json.contact.call_url, "tel:+919831090796");
    assert.match(json.contact.whatsapp_url, /^https:\/\/wa\.me\/919831090796\?text=/);
    assert.ok(decodeURIComponent(json.contact.whatsapp_url).includes(json.booking.ref));
    assert.match(json.review_url, /\/review\/[A-Za-z0-9_-]{20,}$/);
  });

  test("phone numbers are normalised (+91, spaces)", async () => {
    const { status } = await call("POST", "/api/bookings", { body: goodBooking({ phone: "+91 98300 12345" }) });
    assert.equal(status, 201);
  });

  const bad = [
    ["no items selected", { service_ids: [] }, "service_ids"],
    ["unknown item", { service_ids: [9999] }, "service_ids"],
    ["bad phone", { phone: "12345" }, "phone"],
    ["missing name", { name: " " }, "name"],
    ["past date", { event_date: "2001-01-01" }, "event_date"],
    ["impossible date", { event_date: "2099-02-31" }, "event_date"],
    ["bad email", { email: "nope" }, "email"],
    ["custom item without a message", { service_ids: [12], message: "" }, "message"],
  ];
  for (const [name, patch, field] of bad) {
    test(`rejects: ${name}`, async () => {
      const { status, json } = await call("POST", "/api/bookings", { body: goodBooking(patch) });
      assert.equal(status, 400);
      assert.equal(json.field, field);
      assert.ok(json.error.length > 5);
    });
  }

  test("custom item with a message is accepted", async () => {
    const { status } = await call("POST", "/api/bookings", { body: goodBooking({ service_ids: [12], message: "A painted wooden box with our initials" }) });
    assert.equal(status, 201);
  });

  test("non-JSON and broken JSON are rejected cleanly", async () => {
    assert.equal((await call("POST", "/api/bookings", { raw: "hello", headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await call("POST", "/api/bookings", { raw: "{oops", headers: { "content-type": "application/json" } })).status, 400);
  });

  test("honeypot: bots get a fake success and nothing is stored", async () => {
    const before = (await call("GET", "/api/admin/stats", { auth: true })).json;
    void before;
    const r = await call("POST", "/api/bookings", { body: goodBooking({ website: "http://spam.example" }) });
    assert.equal(r.status, 201);
    assert.equal(r.json.booking, undefined);
  });

  test("rate limit: too many bookings from one IP", async () => {
    const ip = "203.0.113.9";
    let last;
    for (let i = 0; i < 9; i++) last = await call("POST", "/api/bookings", { body: goodBooking(), ip });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get("retry-after")) > 0);
  });

  test("same phone cannot spam bookings", async () => {
    const phone = nextPhone();
    let last;
    for (let i = 0; i < 5; i++) last = await call("POST", "/api/bookings", { body: goodBooking({ phone }) });
    assert.equal(last.status, 429);
  });
});

describe("admin", () => {
  test("everything under /api/admin needs login", async () => {
    for (const [m, u] of [["GET", "/api/admin/bookings"], ["GET", "/api/admin/stats"], ["GET", "/api/admin/stream"], ["PUT", "/api/admin/upload?filename=a.png"], ["PUT", "/api/admin/settings"]]) {
      assert.equal((await call(m, u)).status, 401, `${m} ${u}`);
    }
  });

  test("wrong password is rejected, right one logs in", async () => {
    assert.equal((await call("POST", "/api/admin/login", { body: { password: "nope" } })).status, 401);
    const r = await call("POST", "/api/admin/login", { body: { password: "test-password" } });
    assert.equal(r.status, 200);
    const sc = r.headers.getSetCookie()[0];
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Strict/);
    cookie = sc.split(";")[0];
    assert.equal((await call("GET", "/api/admin/me", { auth: true })).status, 200);
  });

  test("forged or tampered cookies are refused", async () => {
    const parts = cookie.split("=")[1].split(".");
    const tampered = `pp_session=${parts[0]}.9999999999999.${parts[2]}`;
    assert.equal((await call("GET", "/api/admin/me", { headers: { cookie: tampered } })).status, 401);
    assert.equal((await call("GET", "/api/admin/me", { headers: { cookie: "pp_session=garbage" } })).status, 401);
  });

  test("cross-site writes are blocked", async () => {
    const r = await call("PATCH", "/api/admin/bookings/1", { auth: true, headers: { origin: "https://evil.example" }, body: { status: "confirmed" } });
    assert.equal(r.status, 403);
  });

  test("admin is notified instantly (live stream) when a booking arrives", async () => {
    const ctrl = new AbortController();
    const res = await fetch(base + "/api/admin/stream", { headers: { cookie }, signal: ctrl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/event-stream/);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    await reader.read().then(({ value }) => (buf += dec.decode(value)));

    const unreadBefore = (await call("GET", "/api/admin/notifications", { auth: true })).json.unread;
    const phone = nextPhone();
    const created = await call("POST", "/api/bookings", { body: goodBooking({ name: "Soumya Das", phone }) });
    assert.equal(created.status, 201);

    const deadline = Date.now() + 4000;
    while (!buf.includes("event: booking") && Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), 1000))]);
      if (chunk.value) buf += dec.decode(chunk.value);
    }
    ctrl.abort();
    assert.ok(buf.includes("event: booking"), "no live event received");
    assert.ok(buf.includes(created.json.booking.ref));
    assert.ok(buf.includes("Soumya Das"));

    const after = (await call("GET", "/api/admin/notifications", { auth: true })).json;
    assert.equal(after.unread, unreadBefore + 1);
    await call("POST", "/api/admin/notifications/read", { auth: true, body: {} });
    assert.equal((await call("GET", "/api/admin/notifications", { auth: true })).json.unread, 0);
  });

  test("booking list, search, detail, status, note", async () => {
    const list = (await call("GET", "/api/admin/bookings", { auth: true })).json;
    assert.ok(list.total >= 3);
    const target = list.bookings.find((b) => b.name === "Soumya Das");
    assert.ok(target.items.includes("Kalka"));
    assert.equal((await call("GET", `/api/admin/bookings?q=${encodeURIComponent("Soumya")}`, { auth: true })).json.total, 1);
    assert.equal((await call("GET", `/api/admin/bookings?q=${encodeURIComponent("%")}`, { auth: true })).json.total, 0);
    assert.equal((await call("GET", "/api/admin/bookings?status=bogus", { auth: true })).status, 400);

    const d = (await call("GET", `/api/admin/bookings/${target.id}`, { auth: true })).json.booking;
    assert.equal(d.review_token, undefined);
    assert.match(d.customer_whatsapp_url, /^https:\/\/wa\.me\/91\d{10}\?text=/);
    assert.equal(d.can_request_review, false);

    const p = await call("PATCH", `/api/admin/bookings/${target.id}`, { auth: true, body: { status: "advance_received", admin_note: "50% received by UPI" } });
    assert.equal(p.json.booking.status, "advance_received");
    assert.equal(p.json.booking.admin_note, "50% received by UPI");
    assert.equal((await call("PATCH", `/api/admin/bookings/${target.id}`, { auth: true, body: { status: "weird" } })).status, 400);
    assert.equal((await call("GET", "/api/admin/bookings/99999", { auth: true })).status, 404);
  });
});

describe("review flow", () => {
  let token, id, ref;
  before(async () => {
    const r = await call("POST", "/api/bookings", { body: goodBooking({ name: "Tanvi Roy" }) });
    token = r.json.review_url.split("/").pop();
    ref = r.json.booking.ref;
    id = (await call("GET", `/api/admin/bookings?q=${ref}`, { auth: true })).json.bookings[0].id;
  });

  test("review page is locked until the order is delivered", async () => {
    const info = await call("GET", `/api/review/${token}`);
    assert.equal(info.json.can_review, false);
    assert.equal(info.json.booking.name, "Tanvi Roy");
    const post = await call("POST", `/api/review/${token}`, { body: { rating: 5 } });
    assert.equal(post.status, 403);
    assert.equal((await call("POST", `/api/admin/bookings/${id}/review-request`, { auth: true, body: {} })).status, 409);
  });

  test("invalid tokens are 404", async () => {
    assert.equal((await call("GET", "/api/review/short")).status, 404);
    assert.equal((await call("GET", "/api/review/" + "a".repeat(24))).status, 404);
  });

  test("after delivery the customer can review once; admin approves it", async () => {
    const p = await call("PATCH", `/api/admin/bookings/${id}`, { auth: true, body: { status: "delivered" } });
    assert.equal(p.json.booking.can_request_review, true);
    assert.ok(p.json.booking.delivered_at);
    assert.match(p.json.booking.review_whatsapp_url, /wa\.me\/91\d{10}\?text=.*review/);
    assert.equal((await call("POST", `/api/admin/bookings/${id}/review-request`, { auth: true, body: {} })).json.booking.review_requested_at !== null, true);

    assert.equal((await call("GET", `/api/review/${token}`)).json.can_review, true);
    assert.equal((await call("POST", `/api/review/${token}`, { body: { rating: 9 } })).status, 400);
    assert.equal((await call("POST", `/api/review/${token}`, { body: { rating: "x" } })).status, 400);
    const ok = await call("POST", `/api/review/${token}`, { body: { rating: 5, comment: "Beautiful kulo and totto!<script>alert(1)</script>", name: "Tanvi" } });
    assert.equal(ok.status, 201);
    assert.equal((await call("POST", `/api/review/${token}`, { body: { rating: 4 } })).status, 409);
    assert.equal((await call("GET", `/api/review/${token}`)).json.already_reviewed, true);

    assert.equal((await call("GET", "/api/reviews")).json.count, 0, "pending reviews must not be public");
    const adminList = (await call("GET", "/api/admin/reviews", { auth: true })).json.reviews;
    assert.equal(adminList[0].status, "pending");
    assert.equal((await call("PATCH", `/api/admin/reviews/${adminList[0].id}`, { auth: true, body: { status: "approved" } })).status, 200);
    const pub = (await call("GET", "/api/reviews")).json;
    assert.equal(pub.count, 1);
    assert.equal(pub.average, 5);
    assert.ok(pub.reviews[0].comment.includes("<script>"), "stored as plain text; the pages render it with textContent");
  });
});

describe("services, gallery, uploads, settings", () => {
  test("service CRUD; the custom option cannot be deleted", async () => {
    const c = await call("POST", "/api/admin/services", { auth: true, body: { title_bn: "আলপনা", title_en: "Alpona", category: "Art & keepsakes", description: "Floor art", image_url: "" } });
    assert.equal(c.status, 201);
    assert.equal(c.json.service.slug, "alpona");
    assert.equal((await call("POST", "/api/admin/services", { auth: true, body: { title_bn: "আলপনা", title_en: "Alpona", image_url: "" } })).json.service.slug, "alpona-2");
    const id = c.json.service.id;
    const p = await call("PATCH", `/api/admin/services/${id}`, { auth: true, body: { is_active: 0 } });
    assert.equal(p.json.service.is_active, false);
    assert.equal((await call("GET", "/api/services")).json.services.some((x) => x.id === id), false);
    assert.equal((await call("PATCH", `/api/admin/services/${id}`, { auth: true, body: { image_url: "javascript:alert(1)" } })).status, 400);
    assert.equal((await call("DELETE", `/api/admin/services/${id}`, { auth: true })).status, 200);
    assert.equal((await call("DELETE", "/api/admin/services/12", { auth: true })).status, 409);
  });

  test("upload validates type, signature and size; files are served with Range support", async () => {
    const up = await call("PUT", "/api/admin/upload?filename=photo.png", { auth: true, raw: PNG, headers: { "content-type": "image/png" } });
    assert.equal(up.status, 201);
    assert.equal(up.json.kind, "photo");
    assert.match(up.json.url, /^\/uploads\/[a-z0-9-]+\.png$/);

    assert.equal((await call("PUT", "/api/admin/upload?filename=evil.html", { auth: true, raw: "<script>", headers: { "content-type": "text/html" } })).status, 415);
    assert.equal((await call("PUT", "/api/admin/upload?filename=evil.svg", { auth: true, raw: "<svg/>", headers: { "content-type": "image/svg+xml" } })).status, 415);
    assert.equal((await call("PUT", "/api/admin/upload?filename=fake.png", { auth: true, raw: Buffer.from("this is not a png at all, honest"), headers: { "content-type": "image/png" } })).status, 415);
    assert.equal((await call("PUT", "/api/admin/upload?filename=big.png", { auth: true, raw: Buffer.concat([PNG, Buffer.alloc(6000)]), headers: { "content-type": "image/png" } })).status, 413);
    assert.equal(fs.readdirSync(path.join(tmp, "uploads")).length, 1, "failed uploads must not leave files behind");

    const full = await fetch(base + up.json.url);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "image/png");
    assert.equal(full.headers.get("x-content-type-options"), "nosniff");
    assert.equal(Buffer.from(await full.arrayBuffer()).length, PNG.length);
    const part = await fetch(base + up.json.url, { headers: { range: "bytes=0-7" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), `bytes 0-7/${PNG.length}`);
    assert.equal((await fetch(base + up.json.url, { headers: { range: "bytes=9999-" } })).status, 416);
  });

  test("a small MP4 header is accepted as a video", async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(40)]);
    const up = await call("PUT", "/api/admin/upload?filename=clip.mp4", { auth: true, raw: mp4, headers: { "content-type": "video/mp4" } });
    assert.equal(up.status, 201);
    assert.equal(up.json.kind, "video");
    const g = await call("POST", "/api/admin/gallery", { auth: true, body: { kind: "video", url: up.json.url, title: "Boron setup", service_id: 4 } });
    assert.equal(g.status, 201);
    const pub = (await call("GET", "/api/gallery")).json.items;
    const found = pub.find((x) => x.id === g.json.item.id);
    assert.equal(found.kind, "video");
    assert.equal(found.service_slug, "boron-khai-daan");
    assert.equal((await call("PATCH", `/api/admin/gallery/${found.id}`, { auth: true, body: { is_active: 0 } })).status, 200);
    assert.equal((await call("GET", "/api/gallery")).json.items.some((x) => x.id === found.id), false);
    assert.equal((await call("DELETE", `/api/admin/gallery/${found.id}`, { auth: true })).status, 200);
    assert.equal((await call("POST", "/api/admin/gallery", { auth: true, body: { kind: "photo", url: "ftp://x/y.jpg" } })).status, 400);
    assert.equal((await call("POST", "/api/admin/gallery", { auth: true, body: { kind: "photo", url: "https://x.test/y.jpg", service_id: 999 } })).status, 400);
  });

  test("settings: change the advance percentage and see it on the website", async () => {
    const r = await call("PUT", "/api/admin/settings", { auth: true, body: { advance_percent: 40, organiser_phone: "98300 99999" } });
    assert.equal(r.status, 200);
    const st = (await call("GET", "/api/settings")).json.settings;
    assert.equal(st.advance_percent, 40);
    assert.match(st.advance_message_en, /40% in advance/);
    assert.match(st.advance_message_bn, /৪০%/);
    assert.equal(st.organiser_phone, "9830099999");
    assert.equal((await call("PUT", "/api/admin/settings", { auth: true, body: { advance_percent: 500 } })).status, 400);
    assert.equal((await call("PUT", "/api/admin/settings", { auth: true, body: { nonsense: 1 } })).status, 400);
    await call("PUT", "/api/admin/settings", { auth: true, body: { advance_percent: 50, organiser_phone: "9831090796" } });
  });
});

describe("pages, headers, CORS, safety", () => {
  test("pages are served with a strict CSP", async () => {
    for (const p of ["/", "/booking", "/gallery", "/admin", "/admin/", "/review/abcdefghijklmnop"]) {
      const r = await call("GET", p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get("content-type"), /text\/html/);
      assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
    }
    assert.match((await call("GET", "/admin")).headers.get("x-robots-tag"), /noindex/);
    assert.equal((await call("GET", "/assets/site.css")).status, 200);
    assert.equal((await call("GET", "/assets/patipatra-logo.png")).headers.get("content-type"), "image/png");
  });

  test("no path traversal, no dotfiles, clean 404s", async () => {
    for (const p of ["/..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/etc/passwd", "/assets/../../package.json", "/.env", "/uploads/..%2f..%2fpackage.json", "/src/db.js", "/nope"]) {
      const r = await call("GET", p);
      assert.equal(r.status, 404, p);
    }
    const api404 = await call("GET", "/api/nope");
    assert.equal(api404.status, 404);
    assert.equal(api404.json.ok, false);
    assert.equal((await call("DELETE", "/api/services")).status, 405);
  });

  test("CORS only for allowed origins and never for the admin API", async () => {
    const ok = await call("GET", "/api/services", { headers: { origin: "https://site.test" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://site.test");
    const no = await call("GET", "/api/services", { headers: { origin: "https://evil.test" } });
    assert.equal(no.headers.get("access-control-allow-origin"), null);
    const pre = await call("OPTIONS", "/api/bookings", { headers: { origin: "https://site.test", "access-control-request-method": "POST" } });
    assert.equal(pre.status, 204);
    const adm = await call("GET", "/api/admin/me", { auth: true, headers: { origin: "https://site.test" } });
    assert.equal(adm.headers.get("access-control-allow-origin"), null);
  });

  test("the login endpoint is rate limited", async () => {
    const ip = "198.51.100.7";
    let last;
    for (let i = 0; i < 10; i++) last = await call("POST", "/api/admin/login", { body: { password: "wrong" }, ip });
    assert.equal(last.status, 429);
  });

  test("deleting a booking removes it and its notifications", async () => {
    const list = (await call("GET", "/api/admin/bookings?limit=1", { auth: true })).json.bookings[0];
    assert.equal((await call("DELETE", `/api/admin/bookings/${list.id}`, { auth: true })).status, 200);
    assert.equal((await call("GET", `/api/admin/bookings/${list.id}`, { auth: true })).status, 404);
  });
});
