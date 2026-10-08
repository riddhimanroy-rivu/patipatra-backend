// Shared helpers for the customer-facing pages (booking, gallery, review).
// Everything the visitor typed is inserted with textContent, never innerHTML.

const apiMeta = document.querySelector('meta[name="api-base"]');
/** Leave empty when these pages are served by this backend. Set it when you copy the pages elsewhere. */
export const API_BASE = (apiMeta?.content || "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, { status = 0, field = "" } = {}) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: API_BASE ? "omit" : "same-origin",
    });
  } catch {
    throw new ApiError("Could not reach the server. Please check your internet connection and try again.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok || (data && data.ok === false)) {
    throw new ApiError(data?.error || `Something went wrong (${res.status}).`, { status: res.status, field: data?.field || "" });
  }
  return data;
}

/** Tiny DOM builder: el("div", {class:"x", onClick:fn}, "text", childNode) */
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") n[k] = v;
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, String(v));
  }
  const add = (kid) => {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return n;
}

const NS = "http://www.w3.org/2000/svg";
const ICONS = {
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
  chat: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  arrow: "M5 12h14M14 7l5 5-5 5",
};
export function icon(name, size = 20) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.9");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", ICONS[name] || "");
  s.append(p);
  return s;
}

export function stars(n) {
  const r = Math.max(0, Math.min(5, Math.round(n)));
  return el("span", { class: "stars", role: "img", "aria-label": `${r} out of 5 stars` }, "★".repeat(r), el("span", { class: "off" }, "★".repeat(5 - r)));
}

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function toast(message, { error = false, ms = 4000 } = {}) {
  let area = document.querySelector(".toast-area");
  if (!area) {
    area = el("div", { class: "toast-area", role: "status", "aria-live": "polite" });
    document.body.append(area);
  }
  const t = el("div", { class: "toast" + (error ? " err" : ""), text: message });
  area.append(t);
  setTimeout(() => t.remove(), ms);
}

let settingsPromise = null;
export function loadSettings() {
  settingsPromise ??= api("/api/settings").then((d) => d.settings).catch(() => null);
  return settingsPromise;
}

const navLink = (href, bn, en, active) =>
  el("a", { href, "aria-current": active === href ? "page" : null }, el("span", { class: "bn", text: bn }), el("span", { class: "sc", text: en }));

/** Adds the header and footer. Returns the public settings (or null if they could not be loaded). */
export async function chrome(activePath) {
  const header = el(
    "header",
    { class: "site-header" },
    el(
      "div",
      { class: "wrap bar" },
      el(
        "a",
        { class: "brand", href: "/", "aria-label": "Patipatra home" },
        el("span", { class: "logo" }, el("img", { src: "/assets/patipatra-logo.png", alt: "" })),
        el("span", { class: "brand-text" }, el("span", { class: "bn brand-bn", text: "পাটিপত্র" }), el("span", { class: "sc", text: "Handmade with heritage" }))
      ),
      el("nav", { class: "nav", "aria-label": "Main" }, navLink("/booking", "বুকিং", "Book", activePath), navLink("/gallery", "গ্যালারি", "Gallery", activePath))
    )
  );
  document.body.prepend(header);

  const settings = await loadSettings();
  const row = el("div", { class: "row" });
  if (settings) {
    row.append(
      el("a", { class: "btn gold small", href: settings.call_url }, icon("phone", 16), `Call ${settings.organiser_phone}`),
      el("a", { class: "btn small", style: { color: "#fff", borderColor: "rgba(255,255,255,.4)" }, href: settings.whatsapp_url, target: "_blank", rel: "noopener" }, icon("chat", 16), "WhatsApp")
    );
    if (settings.instagram_url) row.append(el("a", { class: "link", href: settings.instagram_url, target: "_blank", rel: "noopener", text: "Instagram" }));
  }
  const footer = el(
    "footer",
    { class: "site-footer" },
    el(
      "div",
      { class: "wrap inner" },
      el("p", { class: "bn quote", text: settings?.home_quote_bn || "আপনাদের শুভ অনুষ্ঠানকে আরও সুন্দর করে তোলার দায়িত্ব আমাদের" }),
      row,
      el("small", { text: `© ${new Date().getFullYear()} পাটিপত্র · Wedding craft · Preserved memories · Wearable art` })
    )
  );
  document.body.append(footer);
  return settings;
}
