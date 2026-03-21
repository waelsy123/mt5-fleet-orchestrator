import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:";

function getKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) return null;
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext; // no key configured — store plaintext (backward compat)

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: enc:<iv>:<ciphertext>:<tag> (all hex)
  return `${PREFIX}${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

export function decrypt(value: string): string {
  // Plaintext fallback — if not encrypted, return as-is
  if (!value.startsWith(PREFIX)) return value;

  const key = getKey();
  if (!key) {
    console.warn("[crypto] ENCRYPTION_KEY not set but encrypted value found — cannot decrypt");
    return value;
  }

  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return value;

  const [ivHex, ciphertextHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
