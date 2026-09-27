import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_ENV   = 'PARTNER_GITHUB_TOKEN_ENCRYPTION_KEY'

// Each class of secret gets its own key (named by env var), so compromising or
// rotating one never affects the others.
function getKey(keyEnv: string = KEY_ENV): Buffer {
  const raw = process.env[keyEnv]
  if (!raw) throw new Error(keyEnv + ' env var is not set')
  const buf = Buffer.from(raw, 'hex')
  if (buf.length !== 32) throw new Error(keyEnv + ' must be 32 bytes (64 hex chars)')
  return buf
}

/**
 * Encrypt a plaintext string with the key held in `keyEnv`.
 * Returns a colon-delimited string: iv:authTag:ciphertext  (all hex)
 */
export function encryptWithKeyEnv(plain: string, keyEnv: string): string {
  const key    = getKey(keyEnv)
  const iv     = randomBytes(12)              // 96-bit IV — GCM standard
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

/** Decrypt a string produced by encryptWithKeyEnv() using the same key env var. */
export function decryptWithKeyEnv(stored: string, keyEnv: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(':')
  if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid encrypted token format')
  const key      = getKey(keyEnv)
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

/** True if `value` has the iv:authTag:ciphertext shape produced by encryptWithKeyEnv(). */
export function isEncryptedValue(value: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/.test(value)
}

/** Encrypt a partner GitHub token. */
export function encryptToken(plain: string): string {
  return encryptWithKeyEnv(plain, KEY_ENV)
}

/** Decrypt a partner GitHub token produced by encryptToken(). */
export function decryptToken(stored: string): string {
  return decryptWithKeyEnv(stored, KEY_ENV)
}
