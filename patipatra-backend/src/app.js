import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config.js";
import { openDb, seed } from "./db.js";
import { createAuth } from "./auth.js";
import { createNotifier } from "./notify.js";
import { HttpError, Router, sendJson, clientIp, createLimiter, resolveInside, serveFile } from "./http.js";
import { registerPublic } from "./api.js";
import { registerAdmin } from "./admin-api.js";

const PAGES = {
  "/": "index.html",
  "/booking": "booking.html",
  "/gallery": "gallery.html",
  "/review": "review.html",
  "/admin": "admin/index.html",
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function createApp({ cfg, db }) {
  const auth = createAuth(cfg);
  const notifier = createNotifier(cfg);
  const limits = {
    booking: createLimiter({ windowMs: 10 * 60_000, max: 8 }),
    bookingPhone: createLimiter({ windowMs: 60 * 60_000, max: 4 }),
    review: createLimiter({ windowMs: 10 * 60_000, max: 30 }),
    login: createLimiter({ windowMs: 15 * 60_000, max: 8 }),
  };

  const ctx = {
    cfg,
    db,
    auth,
    notifier,
    limits,
    baseUrl(req) {
      if (cfg.publicBaseUrl) return cfg.publicBaseUrl;
      const fwd = cfg.trustProxy ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() : "";
      const proto = fwd === "https" ? "https" : "http";
      return `${proto}://${req.headers.host || "localhost"}`;
    },
  };

  const router = new Router();
  registerPublic(router, ctx);
  registerAdmin(router, ctx);

  function applyCors(req, res, pathname) {
    const origin = req.headers.origin;
    if (!origin || pathname.startsWith("/api/admin")) return false;
    const clean = origin.replace(/\/+$/, "");
    const ok = cfg.allowedOrigins.includes("*") || cfg.allowedOrigins.includes(clean);
    if (!ok) return false;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    return true;
  }

  async function handleApi(req, res, url) {
    const c = { req, res, url, query: url.searchParams, ip: clientIp(req, cfg.trustProxy), params: {} };
    if (req.method === "OPTIONS") {
      if (applyCors(req, res, url.pathname)) {
        res.writeHead(204);
        res.end();
      } else {
        sendJson(res, 404, { ok: false, error: "Not found." });
      }
      return;
    }
    applyCors(req, res, url.pathname);
    const m = router.match(req.method, url.pathname);
    if (!m) throw new HttpError(404, "Not found.");
    if (m.methodNotAllowed) throw new HttpError(405, "Method not allowed.");
    c.params = m.params;
    const out = await m.handler(c);
    if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
  }

  async function handleStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
    let pathname = url.pathname;

    // Uploaded photos and videos
    if (pathname.startsWith("/uploads/")) {
      const abs = resolveInside(cfg.uploadDir, pathname.slice("/uploads".length));
      if (abs && (await serveFile(req, res, abs, { maxAge: 31536000 }))) return;
      throw new HttpError(404, "Not found.");
    }

    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
    let rel = PAGES[pathname];
    let noindex = pathname === "/admin";
    if (!rel && pathname.startsWith("/review/")) {
      rel = PAGES["/review"];
      noindex = true;
    }
    if (pathname === "/review") noindex = true;
    if (pathname === "/admin/" || pathname === "/admin/index.html") rel = PAGES["/admin"];

    const target = rel ? "/" + rel : pathname;
    if (target.split("/").some((seg) => seg.startsWith("."))) throw new HttpError(404, "Not found.");
    const abs = resolveInside(cfg.publicDir, target);
    if (abs) {
      const isHtml = abs.endsWith(".html");
      const extra = {};
      if (isHtml) extra["Content-Security-Policy"] = CSP;
      if (noindex || target.startsWith("/admin")) extra["X-Robots-Tag"] = "noindex, nofollow";
      const maxAge = isHtml || /\.(js|css)$/.test(abs) ? 0 : 86400;
      if (await serveFile(req, res, abs, { maxAge, extraHeaders: extra })) return;
    }
    throw new HttpError(404, "Page not found.");
  }

  async function handle(req, res) {
    const started = Date.now();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (!cfg.quiet) {
      res.on("finish", () => {
        if (req.url && !req.url.startsWith("/api/admin/stream")) {
          console.log(`${req.method} ${req.url.split("?")[0]} ${res.statusCode} ${Date.now() - started}ms`);
        }
      });
    }

    let isApi = false;
    try {
      let url;
      try {
        url = new URL(req.url || "/", "http://localhost");
      } catch {
        throw new HttpError(400, "Bad request.");
      }
      isApi = url.pathname.startsWith("/api/");
      if (isApi) await handleApi(req, res, url);
      else await handleStatic(req, res, url);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        const headers = err.extra?.retryAfter ? { "Retry-After": String(err.extra.retryAfter) } : {};
        if (isApi || req.headers.accept?.includes("application/json")) {
          sendJson(res, err.status, { ok: false, error: err.message, ...(err.extra?.field ? { field: err.extra.field } : {}) }, headers);
        } else {
          const body = `<!doctype html><meta charset="utf-8"><title>${err.status}</title><body style="font-family:sans-serif;padding:3rem;text-align:center"><h1>${err.status}</h1><p>${err.message}</p><p><a href="/">Back to Patipatra</a></p>`;
          res.writeHead(err.status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body), ...headers });
          res.end(req.method === "HEAD" ? undefined : body);
        }
        return;
      }
      console.error("[error]", req.method, req.url, err);
      sendJson(res, 500, { ok: false, error: "Something went wrong on our side. Please try again." });
    }
  }

  return {
    handle,
    ctx,
    close() {
      notifier.close();
      Object.values(limits).forEach((l) => l.stop());
    },
  };
}

/** Create folders, open the database, seed defaults and start listening. */
export async function startServer(overrides = {}) {
  const cfg = loadConfig(overrides);
  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  if (cfg.dbPath !== ":memory:") fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  const db = openDb(cfg.dbPath);
  seed(db, cfg);

  const app = createApp({ cfg, db });
  const server = http.createServer((req, res) => {
    app.handle(req, res).catch((err) => {
      console.error("[fatal]", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.keepAliveTimeout = 65_000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, resolve);
  });
  const port = server.address().port;

  return {
    server,
    cfg,
    db,
    port,
    url: `http://127.0.0.1:${port}`,
    async close() {
      app.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
