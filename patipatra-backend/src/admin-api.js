import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError, readJson, sendJson, parseCookies, cookieHeader } from "./http.js";
import * as v from "./validate.js";
import { nowIso, getSettings } from "./db.js";
import { BOOKING_STATUSES, REVIEWABLE_STATUSES, SETTING_KEYS } from "./seed-data.js";
import { bookingItems, waLink } from "./lib.js";

const COOKIE = "pp_session";
const UPLOAD_KINDS = {
  ".jpg": "photo", ".jpeg": "photo", ".png": "photo", ".webp": "photo", ".gif": "photo",
  ".mp4": "video", ".webm": "video", ".mov": "video",
};

/** Check the first bytes of an upload really match its extension. */
function sniff(ext, h) {
  const is = (...b) => b.every((x, i) => h[i] === x);
  const s = (a, b) => h.subarray(a, b).toString("latin1");
  switch (ext) {
    case ".jpg":
    case ".jpeg": return is(0xff, 0xd8, 0xff);
    case ".png": return is(0x89, 0x50, 0x4e, 0x47);
    case ".gif": return is(0x47, 0x49, 0x46, 0x38);
    case ".webp": return s(0, 4) === "RIFF" && s(8, 12) === "WEBP";
    case ".mp4":
    case ".mov": return s(4, 8) === "ftyp";
    case ".webm": return is(0x1a, 0x45, 0xdf, 0xa3);
    default: return false;
  }
}

const bool = (value, field) => {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  throw new HttpError(400, `${field} must be true or false.`, { field });
};

export function registerAdmin(router, ctx) {
  const { db, auth, notifier, limits, cfg } = ctx;

  function requireAdmin(c) {
    const token = parseCookies(c.req.headers.cookie)[COOKIE];
    if (!auth.verifyToken(token)) throw new HttpError(401, "Please log in.");
    if (c.req.method !== "GET") {
      // Extra CSRF guard on top of SameSite=Strict cookies.
      const origin = c.req.headers.origin;
      if (origin) {
        let host = "";
        try {
          host = new URL(origin).host;
        } catch {
          /* invalid origin -> rejected below */
        }
        if (host !== c.req.headers.host) throw new HttpError(403, "Request blocked.");
      }
    }
  }
  const guard = (fn) => async (c) => {
    requireAdmin(c);
    return fn(c);
  };

  // ------------------------------------------------------------- session
  router.post("/api/admin/login", async (c) => {
    const wait = limits.login.hit(c.ip);
    if (wait) throw new HttpError(429, "Too many login attempts. Please wait and try again.", { retryAfter: wait });
    const body = await readJson(c.req, 4096);
    if (typeof body.password !== "string" || !auth.checkPassword(body.password)) {
      throw new HttpError(401, "Wrong password.");
    }
    sendJson(
      c.res,
      200,
      { ok: true },
      { "Set-Cookie": cookieHeader(COOKIE, auth.issueToken(), { maxAge: auth.maxAgeSeconds, secure: cfg.secureCookie }) }
    );
  });

  router.post("/api/admin/logout", (c) => {
    sendJson(c.res, 200, { ok: true }, { "Set-Cookie": cookieHeader(COOKIE, "", { maxAge: 0, secure: cfg.secureCookie }) });
  });

  router.get("/api/admin/me", guard(() => ({ ok: true })));

  // ------------------------------------------------------- live updates
  router.get("/api/admin/stream", (c) => {
    requireAdmin(c);
    notifier.addClient(c.req, c.res);
  });

  router.get(
    "/api/admin/notifications",
    guard(() => {
      const items = db.prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT 60").all().map((r) => ({ ...r, is_read: !!r.is_read }));
      const unread = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE is_read=0").get().n;
      return { ok: true, items, unread };
    })
  );

  router.post(
    "/api/admin/notifications/read",
    guard(() => {
      db.prepare("UPDATE notifications SET is_read=1 WHERE is_read=0").run();
      return { ok: true };
    })
  );

  router.get(
    "/api/admin/stats",
    guard(() => {
      const byStatus = {};
      for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM bookings GROUP BY status").all()) byStatus[r.status] = r.n;
      return {
        ok: true,
        bookings: byStatus,
        total_bookings: Object.values(byStatus).reduce((a, b) => a + b, 0),
        unread_notifications: db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE is_read=0").get().n,
        pending_reviews: db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status='pending'").get().n,
      };
    })
  );

  // ------------------------------------------------------------ bookings
  function shapeBooking(c, b) {
    const settings = getSettings(db);
    const base = ctx.baseUrl(c.req);
    const reviewUrl = `${base}/review/${b.review_token}`;
    const { review_token: _omit, ...rest } = b;
    const review = db.prepare("SELECT id, name, rating, comment, status FROM reviews WHERE booking_id=?").get(b.id);
    return {
      ...rest,
      items: bookingItems(db, b.id),
      review: review ? { ...review } : null,
      call_url: `tel:+91${b.phone}`,
      customer_whatsapp_url: waLink(
        b.phone,
        `Namaskar ${b.name}, this is ${settings.organiser_name} from Patipatra regarding your booking ${b.ref}.`
      ),
      review_url: reviewUrl,
      review_whatsapp_url: waLink(
        b.phone,
        `Namaskar ${b.name}, thank you for choosing Patipatra! We hope you loved your order. ` +
          `Please take a minute to share your experience with us here: ${reviewUrl}`
      ),
      can_request_review: REVIEWABLE_STATUSES.includes(b.status),
    };
  }

  router.get(
    "/api/admin/bookings",
    guard((c) => {
      const where = [];
      const args = [];
      const status = c.query.get("status");
      if (status) {
        v.oneOf(status, BOOKING_STATUSES, "status");
        where.push("b.status=?");
        args.push(status);
      }
      const q = (c.query.get("q") || "").trim().slice(0, 60);
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
        where.push("(b.name LIKE ? ESCAPE '\\' OR b.phone LIKE ? ESCAPE '\\' OR b.ref LIKE ? ESCAPE '\\')");
        args.push(like, like, like);
      }
      const limit = Math.min(500, Math.max(1, Number.parseInt(c.query.get("limit") || "100", 10) || 100));
      const offset = Math.max(0, Number.parseInt(c.query.get("offset") || "0", 10) || 0);
      const sql = `SELECT b.id, b.ref, b.name, b.phone, b.event_date, b.city, b.status, b.created_at,
          (SELECT group_concat(service_title_en, ', ') FROM booking_items WHERE booking_id=b.id) AS items
        FROM bookings b ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY b.id DESC LIMIT ? OFFSET ?`;
      const bookings = db.prepare(sql).all(...args, limit, offset).map((r) => ({ ...r }));
      const total = db.prepare(`SELECT COUNT(*) AS n FROM bookings b ${where.length ? "WHERE " + where.join(" AND ") : ""}`).get(...args).n;
      return { ok: true, bookings, total };
    })
  );

  const loadBooking = (id) => {
    const b = db.prepare("SELECT * FROM bookings WHERE id=?").get(id);
    if (!b) throw new HttpError(404, "Booking not found.");
    return { ...b };
  };
  const idParam = (c) => v.int(c.params.id, "id", { min: 1, label: "id" });

  router.get("/api/admin/bookings/:id", guard((c) => ({ ok: true, booking: shapeBooking(c, loadBooking(idParam(c))) })));

  router.patch(
    "/api/admin/bookings/:id",
    guard(async (c) => {
      const b = loadBooking(idParam(c));
      const body = await readJson(c.req);
      const sets = [];
      const args = [];
      if (body.status !== undefined) {
        const status = v.oneOf(body.status, BOOKING_STATUSES, "status");
        sets.push("status=?");
        args.push(status);
        if (REVIEWABLE_STATUSES.includes(status) && !b.delivered_at) {
          sets.push("delivered_at=?");
          args.push(nowIso());
        }
      }
      if (body.admin_note !== undefined) {
        sets.push("admin_note=?");
        args.push(v.text(body.admin_note, "admin_note", { max: 2000, multiline: true, label: "note" }));
      }
      if (!sets.length) throw new HttpError(400, "Nothing to update.");
      sets.push("updated_at=?");
      args.push(nowIso());
      db.prepare(`UPDATE bookings SET ${sets.join(", ")} WHERE id=?`).run(...args, b.id);
      return { ok: true, booking: shapeBooking(c, loadBooking(b.id)) };
    })
  );

  router.post(
    "/api/admin/bookings/:id/review-request",
    guard((c) => {
      const b = loadBooking(idParam(c));
      if (!REVIEWABLE_STATUSES.includes(b.status)) {
        throw new HttpError(409, 'Mark the booking as "delivered" first, then ask the customer for a review.');
      }
      db.prepare("UPDATE bookings SET review_requested_at=?, updated_at=? WHERE id=?").run(nowIso(), nowIso(), b.id);
      return { ok: true, booking: shapeBooking(c, loadBooking(b.id)) };
    })
  );

  router.delete(
    "/api/admin/bookings/:id",
    guard((c) => {
      const b = loadBooking(idParam(c));
      db.prepare("DELETE FROM notifications WHERE booking_id=?").run(b.id);
      db.prepare("DELETE FROM bookings WHERE id=?").run(b.id);
      return { ok: true };
    })
  );

  // ------------------------------------------------------------ services
  const serviceFields = (body, { partial }) => {
    const out = {};
    const has = (k) => body[k] !== undefined;
    if (!partial || has("title_bn")) out.title_bn = v.text(body.title_bn, "title_bn", { required: true, max: 80, label: "the Bengali title" });
    if (!partial || has("title_en")) out.title_en = v.text(body.title_en, "title_en", { required: true, max: 80, label: "the English title" });
    if (!partial || has("category")) out.category = v.text(body.category, "category", { max: 60, label: "category" });
    if (!partial || has("description")) out.description = v.text(body.description, "description", { max: 400, multiline: true, label: "description" });
    if (!partial || has("note")) out.note = v.text(body.note, "note", { max: 1000, multiline: true, label: "note" });
    if (!partial || has("image_url")) out.image_url = v.url(body.image_url, "image_url", { label: "image link" });
    if (!partial || has("sort_order")) out.sort_order = body.sort_order === undefined ? 0 : v.int(body.sort_order, "sort_order", { min: -100000, max: 100000, label: "Order" });
    if (has("is_active")) out.is_active = bool(body.is_active, "is_active");
    return out;
  };

  const allServices = () =>
    db.prepare("SELECT * FROM services ORDER BY sort_order, id").all().map((r) => ({ ...r, is_custom: !!r.is_custom, is_active: !!r.is_active }));

  router.get("/api/admin/services", guard(() => ({ ok: true, services: allServices() })));

  router.post(
    "/api/admin/services",
    guard(async (c) => {
      const f = serviceFields(await readJson(c.req), { partial: false });
      let slug = v.slugify(f.title_en);
      for (let i = 2; db.prepare("SELECT 1 FROM services WHERE slug=?").get(slug); i++) slug = `${v.slugify(f.title_en)}-${i}`;
      const info = db
        .prepare(
          `INSERT INTO services (slug,title_bn,title_en,category,description,note,image_url,is_custom,sort_order,is_active,created_at)
           VALUES (?,?,?,?,?,?,?,0,?,?,?)`
        )
        .run(slug, f.title_bn, f.title_en, f.category, f.description, f.note, f.image_url, f.sort_order, f.is_active ?? 1, nowIso());
      const row = db.prepare("SELECT * FROM services WHERE id=?").get(Number(info.lastInsertRowid));
      return sendJson(c.res, 201, { ok: true, service: { ...row, is_custom: false, is_active: !!row.is_active } });
    })
  );

  router.patch(
    "/api/admin/services/:id",
    guard(async (c) => {
      const id = idParam(c);
      if (!db.prepare("SELECT 1 FROM services WHERE id=?").get(id)) throw new HttpError(404, "Service not found.");
      const f = serviceFields(await readJson(c.req), { partial: true });
      const keys = Object.keys(f);
      if (!keys.length) throw new HttpError(400, "Nothing to update.");
      db.prepare(`UPDATE services SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`).run(...keys.map((k) => f[k]), id);
      const row = db.prepare("SELECT * FROM services WHERE id=?").get(id);
      return { ok: true, service: { ...row, is_custom: !!row.is_custom, is_active: !!row.is_active } };
    })
  );

  router.delete(
    "/api/admin/services/:id",
    guard((c) => {
      const id = idParam(c);
      const row = db.prepare("SELECT * FROM services WHERE id=?").get(id);
      if (!row) throw new HttpError(404, "Service not found.");
      if (row.is_custom) throw new HttpError(409, 'The "anything else" option cannot be deleted. You can hide it instead.');
      db.prepare("UPDATE gallery SET service_id=NULL WHERE service_id=?").run(id);
      db.prepare("DELETE FROM services WHERE id=?").run(id);
      return { ok: true };
    })
  );

  // ------------------------------------------------------------- gallery
  const serviceIdOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const id = v.int(value, "service_id", { min: 1, label: "Service" });
    if (!db.prepare("SELECT 1 FROM services WHERE id=?").get(id)) throw new HttpError(400, "That service does not exist.", { field: "service_id" });
    return id;
  };
  const galleryRow = (id) => {
    const r = db.prepare("SELECT * FROM gallery WHERE id=?").get(id);
    return r ? { ...r, is_active: !!r.is_active } : null;
  };

  router.get(
    "/api/admin/gallery",
    guard(() => ({
      ok: true,
      items: db.prepare("SELECT * FROM gallery ORDER BY sort_order, id").all().map((r) => ({ ...r, is_active: !!r.is_active })),
    }))
  );

  router.post(
    "/api/admin/gallery",
    guard(async (c) => {
      const body = await readJson(c.req);
      const kind = v.oneOf(body.kind, ["photo", "video"], "kind");
      const url = v.url(body.url, "url", { label: "file link" });
      if (!url) throw new HttpError(400, "Please add a photo or video file.", { field: "url" });
      const title = v.text(body.title, "title", { max: 120, label: "title" });
      const serviceId = serviceIdOrNull(body.service_id);
      const max = db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM gallery").get().m;
      const sort = body.sort_order === undefined ? max + 10 : v.int(body.sort_order, "sort_order", { min: -100000, max: 100000, label: "Order" });
      const info = db
        .prepare("INSERT INTO gallery (kind,url,title,service_id,sort_order,is_active,created_at) VALUES (?,?,?,?,?,1,?)")
        .run(kind, url, title, serviceId, sort, nowIso());
      return sendJson(c.res, 201, { ok: true, item: galleryRow(Number(info.lastInsertRowid)) });
    })
  );

  router.patch(
    "/api/admin/gallery/:id",
    guard(async (c) => {
      const id = idParam(c);
      if (!galleryRow(id)) throw new HttpError(404, "Item not found.");
      const body = await readJson(c.req);
      const f = {};
      if (body.title !== undefined) f.title = v.text(body.title, "title", { max: 120, label: "title" });
      if (body.service_id !== undefined) f.service_id = serviceIdOrNull(body.service_id);
      if (body.sort_order !== undefined) f.sort_order = v.int(body.sort_order, "sort_order", { min: -100000, max: 100000, label: "Order" });
      if (body.is_active !== undefined) f.is_active = bool(body.is_active, "is_active");
      const keys = Object.keys(f);
      if (!keys.length) throw new HttpError(400, "Nothing to update.");
      db.prepare(`UPDATE gallery SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`).run(...keys.map((k) => f[k]), id);
      return { ok: true, item: galleryRow(id) };
    })
  );

  router.delete(
    "/api/admin/gallery/:id",
    guard((c) => {
      const id = idParam(c);
      if (!galleryRow(id)) throw new HttpError(404, "Item not found.");
      db.prepare("DELETE FROM gallery WHERE id=?").run(id);
      return { ok: true };
    })
  );

  // -------------------------------------------------------------- upload
  // The browser sends the raw file as the request body: PUT /api/admin/upload?filename=photo.jpg
  router.put("/api/admin/upload", async (c) => {
    requireAdmin(c);
    const filename = String(c.query.get("filename") || "");
    const ext = path.extname(filename).toLowerCase();
    const kind = UPLOAD_KINDS[ext];
    if (!kind) throw new HttpError(415, "Only JPG, PNG, WEBP, GIF, MP4, WEBM or MOV files can be uploaded.");

    const limit = kind === "photo" ? cfg.maxImageBytes : cfg.maxUploadBytes;
    const declared = Number(c.req.headers["content-length"] || 0);
    if (declared > limit) throw new HttpError(413, `That file is too large (maximum ${Math.round(limit / 1048576)} MB).`);

    await fsp.mkdir(cfg.uploadDir, { recursive: true });
    const stored = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    const dest = path.join(cfg.uploadDir, stored);

    let total = 0;
    let head = Buffer.alloc(0);
    let checked = false;
    const verify = () => {
      checked = true;
      if (!sniff(ext, head)) throw new HttpError(415, "That file does not look like a real " + ext.slice(1).toUpperCase() + " file.");
    };
    const guardStream = new Transform({
      transform(chunk, _enc, cb) {
        try {
          total += chunk.length;
          if (total > limit) throw new HttpError(413, `That file is too large (maximum ${Math.round(limit / 1048576)} MB).`);
          if (!checked) {
            head = Buffer.concat([head, chunk.subarray(0, 32 - head.length)]);
            if (head.length >= 16) verify();
          }
          cb(null, chunk);
        } catch (err) {
          cb(err);
        }
      },
      flush(cb) {
        try {
          if (!checked) verify();
          if (total === 0) throw new HttpError(400, "The uploaded file is empty.");
          cb();
        } catch (err) {
          cb(err);
        }
      },
    });

    try {
      await pipeline(c.req, guardStream, fs.createWriteStream(dest, { flags: "wx" }));
    } catch (err) {
      await fsp.rm(dest, { force: true });
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "The upload was interrupted. Please try again.");
    }
    return sendJson(c.res, 201, { ok: true, url: `/uploads/${stored}`, kind, size: total });
  });

  // ------------------------------------------------------------- reviews
  router.get(
    "/api/admin/reviews",
    guard(() => ({
      ok: true,
      reviews: db
        .prepare(
          `SELECT r.id, r.name, r.rating, r.comment, r.status, r.created_at, b.ref
           FROM reviews r JOIN bookings b ON b.id = r.booking_id ORDER BY r.id DESC`
        )
        .all()
        .map((r) => ({ ...r })),
    }))
  );

  router.patch(
    "/api/admin/reviews/:id",
    guard(async (c) => {
      const id = idParam(c);
      const body = await readJson(c.req);
      const status = v.oneOf(body.status, ["pending", "approved", "hidden"], "status");
      const info = db.prepare("UPDATE reviews SET status=? WHERE id=?").run(status, id);
      if (!info.changes) throw new HttpError(404, "Review not found.");
      return { ok: true };
    })
  );

  router.delete(
    "/api/admin/reviews/:id",
    guard((c) => {
      const info = db.prepare("DELETE FROM reviews WHERE id=?").run(idParam(c));
      if (!info.changes) throw new HttpError(404, "Review not found.");
      return { ok: true };
    })
  );

  // ------------------------------------------------------------ settings
  router.get("/api/admin/settings", guard(() => ({ ok: true, settings: getSettings(db), keys: SETTING_KEYS })));

  router.put(
    "/api/admin/settings",
    guard(async (c) => {
      const body = await readJson(c.req);
      const clean = {};
      for (const key of Object.keys(body)) {
        if (!SETTING_KEYS.includes(key)) throw new HttpError(400, `Unknown setting: ${key}`, { field: key });
      }
      if (body.organiser_name !== undefined) clean.organiser_name = v.text(body.organiser_name, "organiser_name", { min: 2, max: 60, required: true, label: "the organiser name" });
      if (body.organiser_phone !== undefined) clean.organiser_phone = v.phone(body.organiser_phone, "organiser_phone");
      if (body.instagram_url !== undefined) clean.instagram_url = v.url(body.instagram_url, "instagram_url", { label: "Instagram link" });
      if (body.advance_percent !== undefined) clean.advance_percent = String(v.int(body.advance_percent, "advance_percent", { min: 1, max: 100, label: "Advance percentage" }));
      if (body.advance_message_en !== undefined) clean.advance_message_en = v.text(body.advance_message_en, "advance_message_en", { required: true, max: 400, label: "the English advance message" });
      if (body.advance_message_bn !== undefined) clean.advance_message_bn = v.text(body.advance_message_bn, "advance_message_bn", { required: true, max: 400, label: "the Bengali advance message" });
      if (body.home_quote_bn !== undefined) clean.home_quote_bn = v.text(body.home_quote_bn, "home_quote_bn", { max: 300, label: "the home quote" });

      const up = db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
      for (const [k, val] of Object.entries(clean)) up.run(k, val);
      return { ok: true, settings: getSettings(db) };
    })
  );
}
