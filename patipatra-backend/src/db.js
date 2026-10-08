import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SERVICES, DEFAULT_SETTINGS, DEMO_GALLERY } from "./seed-data.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title_bn    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  image_url   TEXT NOT NULL DEFAULT '',
  is_custom   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  ref                  TEXT NOT NULL UNIQUE,
  review_token         TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  phone                TEXT NOT NULL,
  email                TEXT NOT NULL DEFAULT '',
  event_date           TEXT NOT NULL DEFAULT '',
  city                 TEXT NOT NULL DEFAULT '',
  message              TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'new',
  admin_note           TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  delivered_at         TEXT,
  review_requested_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_status  ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at);

CREATE TABLE IF NOT EXISTS booking_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id       INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id       INTEGER,
  service_title_en TEXT NOT NULL,
  service_title_bn TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_booking ON booking_items(booking_id);

CREATE TABLE IF NOT EXISTS gallery (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('photo','video')),
  url        TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  service_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  booking_id INTEGER,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

export const nowIso = () => new Date().toISOString();

/** Open (and create if needed) the SQLite database. */
export function openDb(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside a transaction; rolls back if it throws. */
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

/** Insert default services/settings (only when missing) and optional sample gallery. */
export function seed(db, cfg) {
  const now = nowIso();

  const hasServices = db.prepare("SELECT COUNT(*) AS n FROM services").get().n > 0;
  if (!hasServices) {
    const ins = db.prepare(
      `INSERT INTO services (slug,title_bn,title_en,category,description,image_url,is_custom,sort_order,is_active,created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?)`
    );
    transaction(db, () => {
      SERVICES.forEach((s, i) =>
        ins.run(s.slug, s.title_bn, s.title_en, s.category, s.description, s.image_url, s.is_custom ? 1 : 0, (i + 1) * 10, now)
      );
    });
  }

  const insSetting = db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  const seeded = db.prepare("SELECT value FROM settings WHERE key='_gallery_seeded'").get();
  if (!seeded && cfg.seedDemoGallery) {
    const find = db.prepare("SELECT id FROM services WHERE slug=?");
    const ins = db.prepare(
      "INSERT INTO gallery (kind,url,title,service_id,sort_order,is_active,created_at) VALUES ('photo',?,?,?,?,1,?)"
    );
    transaction(db, () => {
      DEMO_GALLERY.forEach(([photo, slug], i) => {
        const svc = find.get(slug);
        ins.run(
          `https://images.unsplash.com/photo-${photo}?auto=format&fit=crop&w=1200&q=85`,
          "Sample photo - replace with your own work",
          svc ? svc.id : null,
          (i + 1) * 10,
          now
        );
      });
    });
  }
  insSetting.run("_gallery_seeded", "1");
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing 0/O/1/I

export function newRef(date = new Date()) {
  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  let tail = "";
  const bytes = crypto.randomBytes(4);
  for (const b of bytes) tail += REF_ALPHABET[b % REF_ALPHABET.length];
  return `PP-${yy}${mm}-${tail}`;
}

export const newToken = () => crypto.randomBytes(18).toString("base64url");

/** All settings (without internal "_" keys) as a plain object. */
export function getSettings(db) {
  const out = {};
  for (const row of db.prepare("SELECT key,value FROM settings").all()) {
    if (!row.key.startsWith("_")) out[row.key] = row.value;
  }
  return out;
}
