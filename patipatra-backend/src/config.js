import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Load ".env" (if present) into process.env. Real environment variables always win. */
function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (err) {
    console.warn(`[config] Could not read .env: ${err.message}`);
  }
}

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? "").trim());

/**
 * Build the configuration object.
 * `overrides` is used by the automated tests; normal runs read the environment.
 */
export function loadConfig(overrides = {}) {
  if (!overrides.__skipDotEnv) loadDotEnv();
  const env = process.env;
  const warnings = [];

  const isProd = (env.NODE_ENV || "").toLowerCase() === "production";

  let adminPassword = env.ADMIN_PASSWORD || "";
  if (!adminPassword || adminPassword === "change-this-password") {
    if (isProd && adminPassword === "change-this-password") {
      warnings.push("ADMIN_PASSWORD is still the example value. Change it in your .env file!");
    }
    if (!adminPassword) {
      adminPassword = crypto.randomBytes(9).toString("base64url");
      warnings.push(`ADMIN_PASSWORD is not set. A temporary password was generated for this run: ${adminPassword}`);
    }
  }

  let sessionSecret = env.SESSION_SECRET || "";
  if (!sessionSecret || sessionSecret === "change-this-to-a-long-random-text") {
    sessionSecret = crypto.randomBytes(32).toString("hex");
    warnings.push("SESSION_SECRET is not set. Admin logins will end whenever the server restarts.");
  }

  const dataDir = path.resolve(ROOT, env.DATA_DIR || "data");
  const uploadDir = path.resolve(ROOT, env.UPLOAD_DIR || "uploads");

  const cfg = {
    port: Number.parseInt(env.PORT || "3000", 10),
    host: env.HOST || "0.0.0.0",
    isProd,
    publicBaseUrl: (env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""),
    trustProxy: truthy(env.TRUST_PROXY),
    secureCookie: isProd,
    adminPassword,
    sessionSecret,
    allowedOrigins: (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    dataDir,
    uploadDir,
    dbPath: path.join(dataDir, "patipatra.db"),
    publicDir: path.join(ROOT, "public"),
    maxUploadBytes: Math.max(1, Number.parseInt(env.MAX_UPLOAD_MB || "150", 10)) * 1024 * 1024,
    maxImageBytes: 15 * 1024 * 1024,
    telegramToken: (env.TELEGRAM_BOT_TOKEN || "").trim(),
    telegramChatId: (env.TELEGRAM_CHAT_ID || "").trim(),
    webhookUrl: (env.WEBHOOK_URL || "").trim(),
    seedDemoGallery: env.SEED_DEMO_GALLERY === undefined ? true : truthy(env.SEED_DEMO_GALLERY),
    quiet: false,
    warnings,
  };

  const merged = { ...cfg, ...overrides };
  delete merged.__skipDotEnv;
  if (!Number.isInteger(merged.port) || merged.port < 0 || merged.port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  return merged;
}
