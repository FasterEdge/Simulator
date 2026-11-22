// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
// 网络地址策略：对齐主仓库 ability/address_policy.go 的 CheckAddr / CheckHost 判定集合。
// 唯一有意差异（见 docs/parity.md）：模拟器放行私网地址——示例拓扑全部位于
// 10.0.0.0/8，而主仓库对 docker/influx/controller 额外拒绝私网（生产 SSRF 面）。
// 回环/未指定/组播/链路本地/受限广播、localhost 别名、歧义数字主机名在两侧一律拒绝。
// 文档保留段（100.64/10、192.0.0/24、192.0.2/24、198.18/15、198.51.100/24、
// 203.0.113/24、192.88.99/24、240/4）在主仓库同样不属公网可路由，这里归入
// private：模拟器按私网放行，收紧等级（allowPrivate=false）时一并拒绝。

// 统一 trim，避免各处重复 String(v || '').trim()
export function trimStr(v) {
  return String(v === undefined || v === null ? '' : v).trim()
}

// 剥 IPv6 方括号（tcp://[::1]:1883 这类形态）
export function stripBrackets(host) {
  const h = String(host || '')
  if (h.startsWith('[') && h.endsWith(']') && h.length >= 2) return h.slice(1, -1)
  return h
}

function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((n) => n > 255)) return null
  return parts
}

// 非公网可路由的特殊用途段（对齐主仓库 ability/address_policy.go 的
// specialUseV4Prefixes）：受限广播、保留 Class E、CGNAT、IETF 协议分配、
// 基准测试与文档保留段。这些段要么不是可建连的单播目标，要么不应当出现在
// 任何真实配置里，模拟器按 private 收编：allowPrivate 时放行、收紧时拒绝。
// 注意 255.255.255.255 在主仓库走 isAlwaysRejectedAddr（任何等级都拒），
// 这里单独归到 'broadcast'，保证私网放行也不会把它放出去。
const SPECIAL_USE_V4 = [
  [100, 64, 0, 0, 10],       // 100.64.0.0/10  CGNAT
  [192, 0, 0, 0, 24],        // 192.0.0.0/24   IETF 协议分配
  [192, 0, 2, 0, 24],        // 192.0.2.0/24   文档保留 TEST-NET-1
  [198, 18, 0, 0, 15],       // 198.18.0.0/15  基准测试
  [198, 51, 100, 0, 24],     // 198.51.100.0/24 文档保留 TEST-NET-2
  [203, 0, 113, 0, 24],      // 203.0.113.0/24 文档保留 TEST-NET-3
  [192, 88, 99, 0, 24],      // 192.88.99.0/24 6to4 中继
  [240, 0, 0, 0, 4],         // 240.0.0.0/4    保留（Class E）
]

function inV4Prefix(v4, [a0, b0, c0, d0, bits]) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  const value = ((v4[0] << 24) | (v4[1] << 16) | (v4[2] << 8) | v4[3]) >>> 0
  const net = ((a0 << 24) | (b0 << 16) | (c0 << 8) | d0) >>> 0
  return (value & mask) === (net & mask)
}

// 地址类别：'loopback' | 'unspecified' | 'multicast' | 'linklocal' | 'broadcast' |
//           'private' | 'public' | null（非 IP 字面量）
function ipKind(host) {
  let h = stripBrackets(host).toLowerCase()
  if (!h) return null
  // IPv4-mapped IPv6（::ffff:127.0.0.1）先归一化为 IPv4，否则回环封锁可被绕过
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h)
  if (mapped) h = mapped[1]
  const v4 = parseIPv4(h)
  if (v4) {
    const [a, b] = v4
    if (a === 0 && b === 0 && v4[2] === 0 && v4[3] === 0) return 'unspecified'
    // 受限广播：不是可建连的单播目标，主仓库任何等级都拒，故先于 private 判定
    if (a === 255 && b === 255 && v4[2] === 255 && v4[3] === 255) return 'broadcast'
    if (a === 127) return 'loopback'
    if (a === 169 && b === 254) return 'linklocal'
    if (a >= 224 && a <= 239) return 'multicast'
    if (a === 10) return 'private'
    if (a === 172 && b >= 16 && b <= 31) return 'private'
    if (a === 192 && b === 168) return 'private'
    if (SPECIAL_USE_V4.some((p) => inV4Prefix(v4, p))) return 'private'
    return 'public'
  }
  if (!h.includes(':')) return null
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return 'unspecified'
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return 'loopback'
  if (/^f[cd]/.test(h)) return 'private'
  if (/^fe[89ab]/.test(h)) return 'linklocal'
  if (/^ff/.test(h)) return 'multicast'
  return 'public'
}

export function isIpLiteral(host) {
  return ipKind(host) !== null
}

// 可连接主机判定：回环/未指定/组播/链路本地/受限广播一律拒绝；私网（含文档保留段）
// 由 allowPrivate 决定。
export function isDialableHost(host, { allowPrivate = true } = {}) {
  const h = stripBrackets(host)
  if (!h) return false
  const kind = ipKind(h)
  if (kind === null) return h.toLowerCase().replace(/\.$/, '') !== 'localhost'
  if (kind === 'loopback' || kind === 'unspecified' || kind === 'multicast' || kind === 'linklocal' || kind === 'broadcast') return false
  if (kind === 'private') return allowPrivate
  return true
}

// 端口：1..65535 的纯数字
function isValidPort(port) {
  const p = String(port === undefined || port === null ? '' : port)
  if (!p || p.length > 5 || !/^\d+$/.test(p)) return false
  const n = Number(p)
  return n >= 1 && n <= 65535
}

// host:port（或 [v6]:port）拆分；格式不合法返回 null
export function splitHostPort(addr) {
  const s = trimStr(addr)
  if (!s) return null
  const ci = s.lastIndexOf(':')
  if (ci <= 0) return null
  const host = stripBrackets(s.slice(0, ci))
  const port = s.slice(ci + 1)
  if (!host || !isValidPort(port)) return null
  return { host, port }
}

// 主机名白名单：字母数字、点、连字符、下划线
function isHostnameCharset(host) {
  return /^[a-zA-Z0-9._-]+$/.test(host)
}

// 对齐主仓库 isLegacyNumericHost："看起来是 IPv4 但 netip 解析不了"的歧义写法
// （127.1、0x7f.0.0.1、2130706433、0177.0.0.1）在 Windows 与 glibc 上结论相反，
// 一律按不可审计地址拒绝。
function isLegacyNumericHost(name) {
  const labels = String(name || '').split('.')
  if (labels.length > 4) return false
  for (const label of labels) {
    if (!label) return false
    let body = label
    if (body.startsWith('0x') || body.startsWith('0X')) {
      body = body.slice(2)
      if (!body || !/^[0-9a-fA-F]+$/.test(body)) return false
      continue
    }
    if (!/^[0-9]+$/.test(body)) return false
  }
  return true
}

// 回环别名（localhost / *.localhost）判定；allowLoopback=false 时拒绝
function isLoopbackAlias(host) {
  const name = String(host || '').toLowerCase().replace(/\.$/, '')
  return name === 'localhost' || name.endsWith('.localhost')
}

// 主机名整体可接受性：字符集合法、非歧义数字主机名、非回环别名
export function isAcceptableHostname(host, { allowLoopback = false } = {}) {
  const h = String(host || '')
  if (!h) return false
  if (!isHostnameCharset(h)) return false
  const name = h.toLowerCase().replace(/\.$/, '')
  if (isLegacyNumericHost(name)) return false
  if (!allowLoopback && isLoopbackAlias(name)) return false
  return true
}
