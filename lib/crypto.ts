import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_ENV   = 'PARTNER_GITHUB_TOKEN_ENCRYPTION_KEY'

function getKey(): Buffer {
  const raw = process.env[KEY_ENV]
  if (!raw) throw new Error('PARTNER_GITHUB_TOKEN_ENCRYPTION_KEY env var is not set')
  const buf = Buffer.from(raw, 'hex')
  if (buf.length !== 32) throw new Error('PARTNER_GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  return buf
}

/**
 * Encrypt a plaintext string.
 * Returns a colon-delimited string: iv:authTag:ciphertext  (all hex)
 */
export function encryptToken(plain: string): string {
  const key    = getKey()
  const iv     = randomBytes(12)              // 96-bit IV — GCM standard
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

/**
 * Decrypt a string produced by encryptToken().
 * Returns the original plaintext.
 */
export function decryptToken(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(':')
  if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid encrypted token format')
  const key      = getKey()
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}
