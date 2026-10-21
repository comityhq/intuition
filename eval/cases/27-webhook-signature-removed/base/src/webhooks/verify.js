import crypto from "node:crypto";

export function verifySignature(rawBody, header, secret) {
  if (!header) return false;
  const [ts, sig] = header.split(",").map((p) => p.split("=")[1]);
  const expected = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return sig?.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
