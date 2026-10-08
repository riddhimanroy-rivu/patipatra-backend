import { HttpError } from "./http.js";

function fail(field, message) {
  throw new HttpError(400, message, { field });
}

/** Trim, strip control characters, enforce length. */
export function text(value, field, { min = 0, max = 200, required = false, label = field, multiline = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") fail(field, `${label} must be text.`);
  let v = value.replace(/\r\n/g, "\n");
  // eslint-disable-next-line no-control-regex
  v = v.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ");
  v = v.trim();
  if (!v && required) fail(field, `Please enter ${label}.`);
  if (v && v.length < min) fail(field, `${label} is too short.`);
  if (v.length > max) fail(field, `${label} is too long (maximum ${max} characters).`);
  return v;
}

/** Indian mobile number -> 10 digits. */
export function phone(value, field = "phone") {
  if (typeof value !== "string" && typeof value !== "number") fail(field, "Please enter your mobile number.");
  let d = String(value).replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) fail(field, "Please enter a valid 10-digit Indian mobile number.");
  return d;
}

export function email(value, field = "email") {
  const v = text(value, field, { max: 120, label: "email" });
  if (!v) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) fail(field, "Please enter a valid email address.");
  return v;
}

/** Date in India right now, as YYYY-MM-DD. */
export function todayIst(now = Date.now()) {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function isoDate(value, field = "event_date", { allowPast = false } = {}) {
  const v = text(value, field, { max: 10, label: "date" });
  if (!v) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(field, "Please choose a valid date.");
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail(field, "Please choose a valid date.");
  if (!allowPast && v < todayIst()) fail(field, "The event date cannot be in the past.");
  if (v > "2100-12-31") fail(field, "Please choose a valid date.");
  return v;
}

export function int(value, field, { min = -1e9, max = 1e9, label = field } = {}) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) fail(field, `${label} must be a whole number between ${min} and ${max}.`);
  return n;
}

/** Empty string, a local /uploads/... path, or an http(s) URL. */
export function url(value, field, { label = "link" } = {}) {
  const v = text(value, field, { max: 500, label });
  if (!v) return "";
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(v)) return v;
  let u;
  try {
    u = new URL(v);
  } catch {
    fail(field, `Please enter a valid ${label}.`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") fail(field, `Please enter a valid ${label}.`);
  return u.toString();
}

export function oneOf(value, list, field) {
  if (!list.includes(value)) fail(field, `${field} must be one of: ${list.join(", ")}.`);
  return value;
}

export function slugify(s) {
  const base = String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "service";
}
