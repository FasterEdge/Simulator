// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
// 模拟用的密码学工具：HMAC-SHA256（WebCrypto）、指纹、随机
const encoder = new TextEncoder()

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function bytesToBase64(bytes) {
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin)
}

export function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function strToBytes(s) {
  return encoder.encode(s)
}

export function randomBytes(n) {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

export function randomHex(n) {
  return bytesToHex(randomBytes(n))
}

export function randomToken(len = 24) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  const bytes = randomBytes(len)
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length]
  return out
}

// HMAC-SHA256，payload 为字符串（UTF-8），key 为 Uint8Array
export async function hmacSha256(keyBytes, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, strToBytes(payload))
  return new Uint8Array(sig)
}

// 返回 base64url 编码的 HMAC-SHA256 签名
export async function hmacSignBase64Url(keyBytes, payload) {
  const sig = await hmacSha256(keyBytes, payload)
  const b64 = bytesToBase64(sig)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

// SHA-256 十六进制摘要（用于密钥指纹，不回显明文）
export async function sha256Hex(payload) {
  const data = strToBytes(payload)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}
