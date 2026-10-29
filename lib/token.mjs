import crypto from "node:crypto";

export function issueToken(secret, userId, ttlSec = 30, now = Date.now()) {
  const payload = {
    uid: userId,
    jti: crypto.randomBytes(8).toString("hex"),
    exp: now + ttlSec * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return { token: `${body}.${sig}`, exp: payload.exp, jti: payload.jti };
}

export function verifyToken(secret, token, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return { ok: false, reason: "unknown" };
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { ok: false, reason: "unknown" };
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.jti || !payload?.uid) return { ok: false, reason: "unknown" };
    if (payload.exp < now) return { ok: false, reason: "expired", payload };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "unknown" };
  }
}
