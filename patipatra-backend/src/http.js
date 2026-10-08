import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
};

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

export async function readJson(req, limit = 64 * 1024) {
  const type = String(req.headers["content-type"] || "");
  if (!/^application\/json\b/i.test(type)) {
    throw new HttpError(415, "Please send JSON (Content-Type: application/json).");
  }
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) throw new HttpError(413, "Request is too large.");

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request is too large.");
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
  return parsed;
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function cookieHeader(name, value, { maxAge, secure, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict`;
  if (httpOnly) c += "; HttpOnly";
  if (secure) c += "; Secure";
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || "unknown";
}

/** Tiny in-memory rate limiter: `max` hits per `windowMs` per key. */
export function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      const fresh = list.filter((t) => t > cutoff);
      if (fresh.length) hits.set(k, fresh);
      else hits.delete(k);
    }
  }, Math.max(windowMs, 30_000));
  timer.unref();

  return {
    /** Returns 0 if allowed, otherwise the number of seconds to wait. */
    hit(key) {
      const now = Date.now();
      const list = (hits.get(key) || []).filter((t) => t > now - windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000));
      }
      list.push(now);
      hits.set(key, list);
      return 0;
    },
    stop() {
      clearInterval(timer);
    },
  };
}

/** Resolve a URL path inside `root`; returns null if it would escape the folder. */
export function resolveInside(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const abs = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

/** Serve a file with Range support (needed for video seeking on phones). */
export async function serveFile(req, res, abs, { maxAge = 0, extraHeaders = {} } = {}) {
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;

  const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Last-Modified": st.mtime.toUTCString(),
    "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-cache",
    ...extraHeaders,
  };

  let start = 0;
  let end = st.size - 1;
  let status = 200;

  const range = req.headers.range;
  if (range && st.size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m && (m[1] !== "" || m[2] !== "")) {
      if (m[1] === "") {
        const n = Number(m[2]);
        start = Math.max(0, st.size - n);
      } else {
        start = Number(m[1]);
        if (m[2] !== "") end = Math.min(Number(m[2]), st.size - 1);
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
        res.end();
        return true;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
    }
  }

  const length = st.size === 0 ? 0 : end - start + 1;
  headers["Content-Length"] = length;
  res.writeHead(status, headers);

  if (req.method === "HEAD" || length === 0) {
    res.end();
    return true;
  }

  await new Promise((resolve) => {
    const stream = fs.createReadStream(abs, { start, end });
    stream.on("error", () => {
      res.destroy();
      resolve();
    });
    res.on("close", () => {
      stream.destroy();
      resolve();
    });
    stream.on("end", resolve);
    stream.pipe(res);
  });
  return true;
}

/** Minimal router: route("GET", "/api/x/:id", handler). */
export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, handler) {
    const keys = [];
    const source = pattern
      .split("/")
      .map((seg) => {
        if (seg.startsWith(":")) {
          keys.push(seg.slice(1));
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
  }
  get(p, h) { this.add("GET", p, h); }
  post(p, h) { this.add("POST", p, h); }
  put(p, h) { this.add("PUT", p, h); }
  patch(p, h) { this.add("PATCH", p, h); }
  delete(p, h) { this.add("DELETE", p, h); }

  /** Returns {handler, params} | {methodNotAllowed:true} | null */
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          params[k] = m[i + 1];
        }
      });
      return { handler: r.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
