import { ok, fail, invalid } from '../errors.js'
import { randomHex } from '../crypto.js'

const LOGO = `
 _______ _______ _______ _______ _______  ______ _______ ______   ______ _______
 |______ |_____| |______    |    |______ |_____/ |______ |     \\ |  ____ |______
 |       |     | ______|    |    |______ |    \\_ |______ |_____/ |_____| |______
`

const VERSION = '1.0.20260831'

// ============================================================
// BaseData
// ============================================================
export const BaseData = {
  name: 'BaseData',
  kind: 'data',
  category: '基础',
  describe: 'BaseData 存储一些基本数据，可以在其中存储各种基本信息。',
  deps: [],
  initState: () => ({}),
  commands: {
    logo: {
      describe: '返回框架 Logo',
      args: [],
      handler: async () => ok({ text: LOGO }),
    },
    info: {
      describe: '返回框架信息',
      args: [],
      handler: async () => ok(`FasterEdge v${VERSION} - 对称、可靠、安全的多场景边缘计算框架`),
    },
  },
}

// ============================================================
// NetMapData
// ============================================================
export const NetMapData = {
  name: 'NetMapData',
  kind: 'data',
  category: '基础',
  describe: 'NetMapData 存储本节点网络拓扑信息：节点名、网卡接口、默认出网接口。',
  deps: [],
  initState: () => ({
    nodeName: '',
    defaultIface: 'eth0',
    interfaces: [
      { name: 'eth0', mac: '02:42:ac:11:00:01', ipv4: ['10.0.0.10'] },
      { name: 'eth1', mac: '02:42:ac:11:00:02', ipv4: ['192.168.1.20'] },
      { name: 'wlan0', mac: '02:42:ac:11:00:03', ipv4: ['172.16.0.10'] },
    ],
    scannedAt: Date.now(),
  }),
  commands: {
    info: {
      describe: '返回本节点网络拓扑快照',
      args: [],
      handler: async (ctx, a, s) => ok({
        nodeName: s.nodeName,
        defaultIface: s.defaultIface,
        interfaces: JSON.parse(JSON.stringify(s.interfaces)),
        hostAddresses: s.interfaces.find((i) => i.name === s.defaultIface)?.ipv4 || [],
        scannedAt: new Date(s.scannedAt).toISOString(),
      }),
    },
    set_node_name: {
      describe: '设置节点名',
      args: [{ key: 'Name', label: '节点名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = String(a.Name || '').trim()
        if (!name || name !== String(a.Name || '').trim()) return fail(invalid('name must be non-empty'))
        s.nodeName = name
        return ok(name)
      },
    },
    interfaces: {
      describe: '刷新并返回网卡接口列表',
      args: [],
      handler: async (ctx, a, s) => {
        s.scannedAt = Date.now()
        return ok(JSON.parse(JSON.stringify(s.interfaces)))
      },
    },
    set_default_iface: {
      describe: '设置默认出网接口',
      args: [{ key: 'Name', label: '接口名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const iface = s.interfaces.find((i) => i.name === a.Name)
        if (!iface) return fail(invalid(`interface "${a.Name}" not found`))
        s.defaultIface = a.Name
        return ok(a.Name)
      },
    },
  },
}

// ============================================================
// KeyringData
// ============================================================
export const KeyringData = {
  name: 'KeyringData',
  kind: 'data',
  category: '基础',
  describe: 'KeyringData 存储本节点用于加密访问的共享密钥与令牌表。',
  deps: [],
  initState: () => ({
    algorithm: 'HMAC-SHA256',
    secret: randomHex(32),
    totalIssued: 0,
    revokedCount: 0,
    lastRotatedAt: Date.now(),
    defaultTokenTTL: 24 * 3600 * 1000,
    tokens: {},
  }),
  commands: {
    status: {
      describe: '返回密钥状态（指纹、令牌数）',
      args: [],
      handler: async (ctx, a, s) => {
        const active = Object.values(s.tokens).filter((t) => !t.revoked && t.expiresAt > Date.now()).length
        return ok({
          algorithm: s.algorithm,
          secretFinger: s.secret.slice(0, 16) + '…',
          activeTokens: active,
          totalIssued: s.totalIssued,
          lastRotatedAt: new Date(s.lastRotatedAt).toISOString(),
        })
      },
    },
    set_secret: {
      describe: '设置共享密钥（≥16 字节）',
      args: [{ key: 'Secret', label: '密钥', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        if (String(a.Secret || '').length < 16) return fail(invalid('secret too short (min 16 bytes)'))
        s.secret = String(a.Secret)
        s.tokens = {}
        s.totalIssued = 0
        s.revokedCount = 0
        s.lastRotatedAt = Date.now()
        return ok(s.secret.slice(0, 16) + '…')
      },
    },
    rotate: {
      describe: '轮换密钥（旧令牌全部失效）',
      args: [],
      handler: async (ctx, a, s) => {
        s.secret = randomHex(32)
        s.tokens = {}
        s.totalIssued = 0
        s.revokedCount = 0
        s.lastRotatedAt = Date.now()
        return ok(s.secret.slice(0, 16) + '…')
      },
    },
    list_tokens: {
      describe: '列出所有令牌',
      args: [],
      handler: async (ctx, a, s) =>
        ok(Object.values(s.tokens).map((t) => ({ ...t, issuedAt: new Date(t.issuedAt).toISOString(), expiresAt: new Date(t.expiresAt).toISOString() }))),
    },
    issue_token: {
      describe: '签发令牌（内部，不带签名）',
      args: [
        { key: 'Subject', label: '主题', type: 'string', required: true },
        { key: 'TTL', label: 'TTL(秒)', type: 'number' },
      ],
      handler: async (ctx, a, s) => {
        const subject = String(a.Subject || '').trim()
        if (!subject) return fail(invalid('subject empty'))
        const ttl = (a.TTL && Number(a.TTL) > 0 ? Number(a.TTL) : s.defaultTokenTTL / 1000) * 1000
        if (s.tokens[subject] && !s.tokens[subject].revoked && s.tokens[subject].expiresAt > Date.now()) {
          return fail(invalid(`subject "${subject}" has an active token`))
        }
        const tok = { subject, issuedAt: Date.now(), expiresAt: Date.now() + ttl, revoked: false }
        s.tokens[subject] = tok
        s.totalIssued++
        return ok({ subject, issuedAt: tok.issuedAt, expiresAt: tok.expiresAt, revoked: false })
      },
    },
    revoke_token: {
      describe: '吊销指定主题的令牌',
      args: [{ key: 'Subject', label: '主题', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const t = s.tokens[a.Subject]
        if (!t || t.revoked) return fail(invalid('no active token'))
        t.revoked = true
        s.revokedCount++
        return ok(a.Subject)
      },
    },
    revoke_all: {
      describe: '吊销全部令牌',
      args: [],
      handler: async (ctx, a, s) => {
        let n = 0
        for (const t of Object.values(s.tokens)) {
          if (!t.revoked) { t.revoked = true; n++ }
        }
        s.revokedCount += n
        return ok(n)
      },
    },
  },
}

// ============================================================
// ConfigData
// ============================================================
export const ConfigData = {
  name: 'ConfigData',
  kind: 'data',
  category: '基础',
  describe: 'ConfigData 以键值对形式存储节点配置项，支持点号路径扁平命名。',
  deps: [],
  initState: () => ({ values: {} }),
  commands: {
    get: {
      describe: '读取配置项',
      args: [{ key: 'Key', label: '键', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const key = String(a.Key || '').trim()
        if (!validKey(key)) return fail(invalid('invalid key'))
        if (!(key in s.values)) return fail(invalid(`key "${key}" not found`))
        return ok(s.values[key])
      },
    },
    set: {
      describe: '写入配置项',
      args: [
        { key: 'Key', label: '键', type: 'string', required: true },
        { key: 'Value', label: '值', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        const key = String(a.Key || '').trim()
        if (!validKey(key)) return fail(invalid('invalid key'))
        s.values[key] = String(a.Value)
        return ok(s.values[key])
      },
    },
    delete: {
      describe: '删除配置项',
      args: [{ key: 'Key', label: '键', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const key = String(a.Key || '').trim()
        if (!validKey(key)) return fail(invalid('invalid key'))
        if (!(key in s.values)) return fail(invalid(`key "${key}" not found`))
        delete s.values[key]
        return ok(key)
      },
    },
    list: {
      describe: '列出全部键（字典序）',
      args: [],
      handler: async (ctx, a, s) => ok(Object.keys(s.values).sort()),
    },
    snapshot: {
      describe: '返回全部配置快照',
      args: [],
      handler: async (ctx, a, s) => ok(JSON.parse(JSON.stringify(s.values))),
    },
  },
}

function validKey(key) {
  return /^[a-zA-Z0-9._-]+$/.test(key)
}

// ============================================================
// 数据库 Data（工厂）
// ============================================================
function dbConfigFields(configShape) {
  return configShape
}

const dbCommands = (shape) => ({
  configure: {
    describe: `配置 ${shape.name} 公开连接参数`,
    args: shape.args,
    handler: async (ctx, a, s) => {
      const cfg = { ...s.config }
      for (const arg of shape.args) {
        if (a[arg.key] !== undefined && a[arg.key] !== null) {
          cfg[arg.key] = arg.type === 'number' ? Number(a[arg.key]) : String(a[arg.key])
        }
      }
      if (shape.validate && !shape.validate(cfg)) return fail(invalid('invalid config'))
      s.config = cfg
      s.revision++
      return ok({ version: '1', config: JSON.parse(JSON.stringify(s.config)) })
    },
  },
  set_secret: {
    describe: '设置独立密码/令牌（仅保存在私有内存）',
    args: [{ key: 'Secret', label: '密码/令牌', type: 'string', required: true }],
    handler: async (ctx, a, s) => {
      if (String(a.Secret || '').length < 4) return fail(invalid('secret too short'))
      s.hasSecret = true
      s.revision++
      return ok('ok')
    },
  },
  clear_secret: {
    describe: '清除独立密码/令牌',
    args: [],
    handler: async (ctx, a, s) => {
      s.hasSecret = false
      s.revision++
      return ok('ok')
    },
  },
  get_config: {
    describe: '获取公开连接参数（不含密码）',
    args: [],
    handler: async (ctx, a, s) => ok(JSON.parse(JSON.stringify(s.config))),
  },
  status: {
    describe: '查看运行状态与修订号',
    args: [],
    handler: async (ctx, a, s) =>
      ok({ name: shape.name, configured: s.configured, hasSecret: s.hasSecret, revision: s.revision }),
  },
  snapshot: {
    describe: '返回完整快照',
    args: [],
    handler: async (ctx, a, s) =>
      ok({ version: '1', config: JSON.parse(JSON.stringify(s.config)), status: { hasSecret: s.hasSecret, revision: s.revision } }),
  },
})

const SQLConfig = {
  host: { key: 'Host', label: '主机', type: 'string' },
  port: { key: 'Port', label: '端口', type: 'number' },
  database: { key: 'Database', label: '数据库', type: 'string' },
  username: { key: 'Username', label: '用户名', type: 'string' },
  tlsMode: { key: 'TLSMode', label: 'TLS 模式', type: 'select', options: ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'] },
}

export const MySQLData = makeDB('MySQLData', 'MySQL 数据库公开连接参数与独立密码', SQLConfig, { port: 3306 })
export const PostgreSQLData = makeDB('PostgreSQLData', 'PostgreSQL 数据库公开连接参数与独立密码', SQLConfig, { port: 5432 })
export const SQLiteData = makeDB('SQLiteData', 'SQLite 文件、模式、WAL、超时与连接池参数', {
  path: { key: 'Path', label: '文件路径', type: 'string' },
  mode: { key: 'Mode', label: '模式', type: 'select', options: ['ro', 'rw', 'rwc', 'memory'] },
}, { mode: 'rwc' }, false)
export const RedisData = makeDB('RedisData', 'Redis 节点列表、DB、TLS、超时与连接池参数', {
  addresses: { key: 'Addresses', label: '地址列表(逗号分隔)', type: 'string' },
  db: { key: 'DB', label: 'DB 序号', type: 'number' },
  tlsMode: { key: 'TLSMode', label: 'TLS 模式', type: 'select', options: ['disable', 'require'] },
}, { db: 0, tlsMode: 'disable' })
export const MongoDBData = makeDB('MongoDBData', 'MongoDB 节点、认证源、副本集、TLS 与独立密码', {
  hosts: { key: 'Hosts', label: '主机列表(逗号分隔)', type: 'string' },
  authSource: { key: 'AuthSource', label: '认证源', type: 'string' },
  replicaSet: { key: 'ReplicaSet', label: '副本集', type: 'string' },
  tlsMode: { key: 'TLSMode', label: 'TLS 模式', type: 'select', options: ['disable', 'require'] },
}, { authSource: 'admin' })
export const InfluxDBData = makeDB('InfluxDBData', 'InfluxDB Endpoint、Org、Bucket、超时与独立 Token', {
  endpoint: { key: 'Endpoint', label: 'Endpoint', type: 'string' },
  org: { key: 'Org', label: 'Org', type: 'string' },
  bucket: { key: 'Bucket', label: 'Bucket', type: 'string' },
  timeoutSec: { key: 'TimeoutSec', label: '超时(秒)', type: 'number' },
}, { timeoutSec: 10 })

function makeDB(name, describe, shapeArgs, defaults, withSecret = true) {
  const initCfg = {}
  for (const [k, def] of Object.entries(defaults)) initCfg[k] = def
  for (const [k, v] of Object.entries(shapeArgs)) {
    if (!(k in initCfg)) {
      initCfg[k] = v.type === 'number' ? 0 : ''
    }
  }
  return {
    name,
    kind: 'data',
    category: '数据库',
    describe,
    deps: [],
    initState: () => ({ config: JSON.parse(JSON.stringify(initCfg)), hasSecret: false, revision: 0, configured: false }),
    commands: dbCommands({ name, args: Object.values(shapeArgs), validate: (cfg) => true }),
    _withSecret: withSecret,
  }
}

export const dataCatalog = {
  BaseData,
  NetMapData,
  KeyringData,
  ConfigData,
  MySQLData,
  PostgreSQLData,
  SQLiteData,
  RedisData,
  MongoDBData,
  InfluxDBData,
}