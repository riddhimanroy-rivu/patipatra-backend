import crypto from "node:crypto";

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const WEEK_MS = 7 * 24 * 3600 * 1000;

export function createAuth({ adminPassword, sessionSecret }) {
  const passwordDigest = sha(adminPassword);
  const sign = (payload) => crypto.createHmac("sha256", sessionSecret).update(payload).digest("hex");

  return {
    maxAgeSeconds: WEEK_MS / 1000,

    checkPassword(candidate) {
      return crypto.timingSafeEqual(sha(candidate ?? ""), passwordDigest);
    },

    issueToken(now = Date.now()) {
      const payload = `a.${now + WEEK_MS}`;
      return `${payload}.${sign(payload)}`;
    },

    verifyToken(token, now = Date.now()) {
      if (typeof token !== "string") return false;
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== "a") return false;
      const exp = Number(parts[1]);
      if (!Number.isFinite(exp) || exp < now) return false;
      const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`), "hex");
      let given;
      try {
        given = Buffer.from(parts[2], "hex");
      } catch {
        return false;
      }
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    },
  };
}
