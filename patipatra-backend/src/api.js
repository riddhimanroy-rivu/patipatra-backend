import { HttpError, readJson, sendJson } from "./http.js";
import * as v from "./validate.js";
import { transaction, nowIso, newRef, newToken } from "./db.js";
import { REVIEWABLE_STATUSES } from "./seed-data.js";
import { publicSettings, bookingItems, waLink } from "./lib.js";

function limit(limiter, key) {
  const wait = limiter.hit(key);
  if (wait) {
    throw new HttpError(429, "Too many attempts. Please wait a little and try again.", { retryAfter: wait });
  }
}

export function registerPublic(router, ctx) {
  const { db, notifier, limits } = ctx;

  router.get("/api/health", () => ({ ok: true, time: nowIso() }));

  router.get("/api/settings", () => ({ ok: true, settings: publicSettings(db) }));

  router.get("/api/services", () => {
    const services = db
      .prepare(
        `SELECT id, slug, title_bn, title_en, category, description, note, image_url, is_custom
         FROM services WHERE is_active=1 ORDER BY sort_order, id`
      )
      .all()
      .map((r) => ({ ...r, is_custom: !!r.is_custom }));
    const categories = [...new Set(services.map((s) => s.category).filter(Boolean))];
    return { ok: true, services, categories };
  });

  router.get("/api/gallery", () => {
    const items = db
      .prepare(
        `SELECT g.id, g.kind, g.url, g.title, g.service_id, s.slug AS service_slug, s.title_en AS service_title
         FROM gallery g LEFT JOIN services s ON s.id = g.service_id
         WHERE g.is_active=1 ORDER BY g.sort_order, g.id`
      )
      .all()
      .map((r) => ({ ...r }));
    return { ok: true, items };
  });

  router.get("/api/reviews", () => {
    const reviews = db
      .prepare(
        "SELECT id, name, rating, comment, created_at FROM reviews WHERE status='approved' ORDER BY id DESC LIMIT 60"
      )
      .all()
      .map((r) => ({ ...r }));
    const stats = db.prepare("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE status='approved'").get();
    return {
      ok: true,
      reviews,
      count: stats.n,
      average: stats.n ? Math.round(stats.avg * 10) / 10 : null,
    };
  });

  // ------------------------------------------------------------------ bookings
  router.post("/api/bookings", async (c) => {
    const body = await readJson(c.req);

    // Honeypot: real people never see/fill this field. Pretend success to bots.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return sendJson(c.res, 201, { ok: true });
    }

    limit(limits.booking, c.ip);

    const name = v.text(body.name, "name", { min: 2, max: 80, required: true, label: "your name" });
    const phone = v.phone(body.phone);
    const email = v.email(body.email);
    const eventDate = v.isoDate(body.event_date);
    const city = v.text(body.city, "city", { max: 80, label: "city" });
    const message = v.text(body.message, "message", { max: 1500, multiline: true, label: "your message" });

    if (!Array.isArray(body.service_ids) || body.service_ids.length === 0) {
      throw new HttpError(400, "Please select at least one item to book.", { field: "service_ids" });
    }
    if (body.service_ids.length > 40) {
      throw new HttpError(400, "Too many items selected.", { field: "service_ids" });
    }
    const ids = [...new Set(body.service_ids.map((x) => v.int(x, "service_ids", { min: 1, label: "Service" })))];
    const rows = db
      .prepare(`SELECT * FROM services WHERE is_active=1 AND id IN (${ids.map(() => "?").join(",")}) ORDER BY sort_order, id`)
      .all(...ids);
    if (rows.length !== ids.length) {
      throw new HttpError(400, "One of the selected items is no longer available. Please refresh the page and choose again.", {
        field: "service_ids",
      });
    }
    if (rows.some((r) => r.is_custom) && message.length < 5) {
      throw new HttpError(400, "Please tell us a little about what you would like us to make.", { field: "message" });
    }

    limit(limits.bookingPhone, phone);

    const now = nowIso();
    let ref = "";
    const token = newToken();
    const bookingId = transaction(db, () => {
      let id = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        ref = newRef();
        try {
          id = Number(
            db
              .prepare(
                `INSERT INTO bookings (ref, review_token, name, phone, email, event_date, city, message, status, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?, 'new', ?, ?)`
              )
              .run(ref, token, name, phone, email, eventDate, city, message, now, now).lastInsertRowid
          );
          break;
        } catch (err) {
          if (!/UNIQUE/i.test(String(err.message)) || attempt === 7) throw err;
        }
      }
      const insItem = db.prepare(
        "INSERT INTO booking_items (booking_id, service_id, service_title_en, service_title_bn) VALUES (?,?,?,?)"
      );
      for (const s of rows) insItem.run(id, s.id, s.title_en, s.title_bn);
      return id;
    });

    const base = ctx.baseUrl(c.req);
    const settings = publicSettings(db);
    const titlesEn = rows.map((r) => r.title_en);

    // Admin notification (stored, shown live in the admin panel, optionally Telegram/webhook)
    const title = `New booking ${ref}`;
    const bodyText =
      `${name} (${phone})\n` +
      `Wants: ${titlesEn.join(", ")}\n` +
      `Event: ${eventDate || "date not given"}${city ? ", " + city : ""}\n` +
      (message ? `Note: ${message.slice(0, 300)}\n` : "") +
      `Open: ${base}/admin`;
    const notifId = Number(
      db
        .prepare("INSERT INTO notifications (type,title,body,booking_id,is_read,created_at) VALUES ('booking',?,?,?,0,?)")
        .run(title, bodyText, bookingId, now).lastInsertRowid
    );
    notifier.broadcast("booking", {
      id: notifId,
      booking_id: bookingId,
      ref,
      title,
      body: bodyText,
      name,
      phone,
      items: titlesEn,
      created_at: now,
    });
    void notifier.deliverExternal("booking", title, bodyText);

    const customerText =
      `Hello ${settings.organiser_name}, I have just booked on Patipatra.\n` +
      `Booking ID: ${ref}\nName: ${name}\nI have selected: ${titlesEn.join(", ")}.\n` +
      `I would like to discuss my requirements.`;

    sendJson(c.res, 201, {
      ok: true,
      booking: {
        ref,
        name,
        status: "new",
        event_date: eventDate,
        city,
        items: rows.map((r) => ({ title_en: r.title_en, title_bn: r.title_bn })),
      },
      advance_percent: settings.advance_percent,
      advance_message_en: settings.advance_message_en,
      advance_message_bn: settings.advance_message_bn,
      contact: {
        organiser_name: settings.organiser_name,
        phone: settings.organiser_phone,
        call_url: settings.call_url,
        whatsapp_url: waLink(settings.organiser_phone, customerText),
      },
      review_url: `${base}/review/${token}`,
      review_note_en: "Please keep this link. After you receive your order, open it to share your review with us.",
      review_note_bn: "এই লিঙ্কটি রেখে দিন। অর্ডার হাতে পাওয়ার পর এখানে আপনার মতামত জানাবেন।",
    });
  });

  // ------------------------------------------------------------------- reviews
  function bookingByToken(token) {
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) throw new HttpError(404, "This review link is not valid.");
    const b = db.prepare("SELECT * FROM bookings WHERE review_token=?").get(token);
    if (!b) throw new HttpError(404, "This review link is not valid.");
    return b;
  }

  router.get("/api/review/:token", (c) => {
    limit(limits.review, c.ip);
    const b = bookingByToken(c.params.token);
    const review = db.prepare("SELECT name, rating, comment FROM reviews WHERE booking_id=?").get(b.id);
    return {
      ok: true,
      booking: { ref: b.ref, name: b.name, status: b.status, items: bookingItems(db, b.id) },
      can_review: REVIEWABLE_STATUSES.includes(b.status) && !review,
      cancelled: b.status === "cancelled",
      already_reviewed: !!review,
      review: review ? { ...review } : null,
    };
  });

  router.post("/api/review/:token", async (c) => {
    limit(limits.review, c.ip);
    const b = bookingByToken(c.params.token);
    const body = await readJson(c.req);

    if (!REVIEWABLE_STATUSES.includes(b.status)) {
      throw new HttpError(403, "You can review us once you have received your order. Thank you for your patience!");
    }
    if (db.prepare("SELECT 1 FROM reviews WHERE booking_id=?").get(b.id)) {
      throw new HttpError(409, "You have already shared your review. Thank you!");
    }
    const rating = v.int(body.rating, "rating", { min: 1, max: 5, label: "Rating" });
    const comment = v.text(body.comment, "comment", { max: 1000, multiline: true, label: "your review" });
    const name = v.text(body.name, "name", { max: 60, label: "your name" }) || b.name;

    const now = nowIso();
    db.prepare("INSERT INTO reviews (booking_id,name,rating,comment,status,created_at) VALUES (?,?,?,?, 'pending', ?)").run(
      b.id, name, rating, comment, now
    );
    const title = `New review (${rating}/5) for ${b.ref}`;
    const text = `${name} rated ${rating}/5${comment ? `:\n${comment.slice(0, 300)}` : "."}\nApprove it in the admin panel to show it on the website.`;
    const notifId = Number(
      db
        .prepare("INSERT INTO notifications (type,title,body,booking_id,is_read,created_at) VALUES ('review',?,?,?,0,?)")
        .run(title, text, b.id, now).lastInsertRowid
    );
    notifier.broadcast("review", { id: notifId, booking_id: b.id, ref: b.ref, title, body: text, created_at: now });
    void notifier.deliverExternal("review", title, text);

    sendJson(c.res, 201, { ok: true, message: "Thank you! Your review means a lot to us." });
  });

}
