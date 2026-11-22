// ─────────────────────────────────────────────────────────────
// FasterEdge 开源项目
// Github: https://github.com/FasterEdge
// Gitee:  https://gitee.com/FasterEdge
// ─────────────────────────────────────────────────────────────
import { ok, fail, invalid } from '../errors.js'
import { randomToken } from '../crypto.js'
import { trimStr, splitHostPort, isDialableHost, isIpLiteral, isAcceptableHostname, stripBrackets } from '../netpolicy.js'

// 可接受的 Broker scheme（对齐主仓库），拒绝回环/未指定/未知 scheme
const BROKER_SCHEMES = ['tcp', 'tls', 'ssl', 'ws', 'wss']
// 对齐主仓库 isAcceptableBrokerURL：scheme 白名单、拒绝 userinfo、host 非空、
// host:port 端口必须显式声明、IP 字面量拒绝回环/未指定、主机名拒绝回环别名。
function validBrokerURL(url) {
  const s = trimStr(url)
  if (!s) return false
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/.exec(s)
  if (!m || !BROKER_SCHEMES.includes(m[1].toLowerCase())) return false
  const hostport = m[2]
  if (!hostport || hostport.includes('@')) return false // userinfo 手法可绕过回环名单
  const hp = splitHostPort(hostport)
  if (!hp) return false // 主仓库要求 Hostname/Port 均可解析
  if (isIpLiteral(hp.host)) return isDialableHost(hp.host, { allowPrivate: true })
  return isAcceptableHostname(hp.host)
}

// 对齐主仓库 isAcceptableIdentifier：仅 [a-zA-Z0-9._-]，非空
function validIdentifier(s) {
  return typeof s === 'string' && s !== '' && /^[a-zA-Z0-9._-]+$/.test(s)
}

// 对齐主仓库 validateName：trim 后 1..255 且仅 [a-zA-Z0-9._-]
function validName(s) {
  const v = trimStr(s)
  if (!v || v.length > 255) return false
  return /^[a-zA-Z0-9._-]+$/.test(v)
}

// 对齐主仓库 validateInfluxEndpoint：http/https、无 userinfo、无 fragment、
// host 非空、IP 字面量拒绝回环/未指定/链路本地/组播（私网放行，见 parity.md）
function validInfluxEndpoint(endpoint) {
  const raw = trimStr(endpoint)
  if (!raw) return false
  if (raw.includes('#')) return false // fragment
  const m = /^(https?):\/\/([^/?#]*)/i.exec(raw)
  if (!m) return false
  const hostport = m[2]
  if (!hostport || hostport.includes('@')) return false
  const hp = splitHostPort(hostport)
  const host = hp ? hp.host : stripBrackets(hostport.split(':')[0])
  if (!host) return false
  if (isIpLiteral(host)) return isDialableHost(host, { allowPrivate: true })
  return isAcceptableHostname(host)
}

// 对齐主仓库 isValidDockerEndpoint：unix:// 或 tcp/tls://+可解析 host
function validDockerEndpoint(url) {
  const s = trimStr(url)
  if (!s) return false
  const lower = s.toLowerCase()
  if (lower.startsWith('unix://')) return s.length > 'unix://'.length
  if (!lower.startsWith('tcp://') && !lower.startsWith('tls://')) return false
  const rest = s.slice(lower.indexOf('://') + 3)
  const hostport = rest.split(/[/?#]/)[0]
  if (!hostport || hostport.includes('@')) return false
  const hp = splitHostPort(hostport)
  const host = hp ? hp.host : stripBrackets(hostport.split(':')[0])
  if (!host) return false
  return isDialableHost(host, { allowPrivate: true })
}

// 对齐主仓库 isValidDockerIDOrName：≤128，[a-zA-Z0-9_.-]（拒绝 / \ .. 与 query 分隔符）
function validDockerIDOrName(s) {
  const v = String(s ?? '')
  if (!v || v.length > 128) return false
  return /^[a-zA-Z0-9_.-]+$/.test(v)
}

// 对齐主仓库 isValidDockerImageRef：≤512，[a-zA-Z0-9._/-:@]
function validDockerImageRef(s) {
  const v = String(s ?? '')
  if (!v || v.length > 512) return false
  return /^[a-zA-Z0-9._/@:-]+$/.test(v)
}

// 对齐主仓库 isValidK8sKind：≤253，[a-zA-Z0-9.-] 且至少一个字母数字
function validK8sName(s) {
  const v = String(s ?? '')
  if (!v || v.length > 253) return false
  return /^[a-zA-Z0-9.-]+$/.test(v) && /[a-zA-Z0-9]/.test(v)
}

// 把 MQTTAbility 的本地订阅同步到世界 Broker（跨节点路由依赖它）
function syncBrokerSubs(ctx, s) {
  if (ctx.world?.broker) {
    ctx.world.broker.subs[ctx.node.id] = s.subscriptions.map((x) => ({ topic: x.topic, qos: x.qos }))
  }
}

// ============================================================
// MQTTAbility（可插拔 Transport，模拟世界级 Broker 路由）
// ============================================================
export const MQTTAbility = {
  name: 'MQTTAbility',
  kind: 'ability',
  category: '数据交互',
  describe: 'MQTTAbility 提供 MQTT 客户端能力：连接/发布/订阅/排空。Transport 将在世界 Broker 中跨节点路由消息。',
  deps: ['BaseData'],
  initState: () => ({
    broker: 'tcp://sim-broker:1883',
    clientId: 'fe-' + randomToken(6),
    connected: false,
    subscriptions: [],
    inbox: [],
  }),
  commands: {
    set_broker: {
      describe: '设置 Broker 地址（tcp/tls/ws 等 scheme）',
      args: [{ key: 'URL', label: 'Broker URL', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const url = trimStr(a.URL)
        if (!url) return fail(invalid('broker url empty'))
        if (!validBrokerURL(url)) return fail(invalid(`unsupported broker URL: ${url}`))
        s.broker = url
        return ok(s.broker)
      },
    },
    get_broker: {
      describe: '获取 Broker 地址',
      args: [],
      handler: async (ctx, a, s) => ok(s.broker),
    },
    set_credentials: {
      describe: '设置凭据',
      args: [
        { key: 'Username', label: '用户名', type: 'string' },
        { key: 'Password', label: '密码', type: 'string' },
      ],
      handler: async (ctx, a, s) => {
        s.username = String(a.Username || '')
        s.password = String(a.Password || '')
        return ok('credentials set')
      },
    },
    set_client_id: {
      describe: '设置 ClientID',
      args: [{ key: 'ClientID', label: 'ClientID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库：trim 后必须非空（旧实现空串也能覆盖默认 clientId）
        const id = trimStr(a.ClientID)
        if (!id) return fail(invalid('client id empty'))
        s.clientId = id
        return ok(s.clientId)
      },
    },
    connect: {
      describe: '连接 Broker（在世界 Broker 注册；重连后补投匹配的留存消息）',
      args: [],
      handler: async (ctx, a, s) => {
        s.connected = true
        // 先同步订阅，再注册会话，便于 Broker 在 connect 时补投保留消息
        syncBrokerSubs(ctx, s)
        ctx.world.broker.connect(ctx.node.id, s.broker, s.clientId)
        return ok({ broker: s.broker, clientId: s.clientId, connected: true })
      },
    },
    disconnect: {
      describe: '断开连接',
      args: [],
      handler: async (ctx, a, s) => {
        ctx.world.broker.disconnect(ctx.node.id)
        s.connected = false
        return ok({ connected: false })
      },
    },
    is_connected: {
      describe: '查询连接状态',
      args: [],
      handler: async (ctx, a, s) => ok(s.connected),
    },
    subscribe: {
      describe: '订阅主题（支持 + / # 通配符；订阅后补投匹配的留存消息）',
      args: [
        { key: 'Topic', label: '主题', type: 'string', required: true },
        { key: 'Qos', label: 'QoS', type: 'select', options: [0, 1, 2] },
      ],
      handler: async (ctx, a, s) => {
        const topic = trimStr(a.Topic)
        // 对齐主仓库 subscribe：topic 非空、≤65535（MQTT UTF-8 字符串上限）、Qos ≤ 2
        if (!topic) return fail(invalid('topic empty'))
        if (topic.length > 65535) return fail(invalid('topic too long'))
        const qos = a.Qos !== undefined ? Number(a.Qos) : 0
        if (!Number.isInteger(qos) || qos < 0 || qos > 2) return fail(invalid('invalid qos'))
        const sub = { topic, qos, nodeId: ctx.node.id, clientId: s.clientId }
        const existing = s.subscriptions.find((x) => x.topic === topic)
        if (existing) existing.qos = qos
        else s.subscriptions.push(sub)
        syncBrokerSubs(ctx, s)
        // 留存消息只在订阅那一刻与 filter 匹配才补投（MQTT 3.1.1 §3.3.1.3）
        const retained = ctx.world.broker.deliverRetained(ctx.node.id)
        return ok({ topic, qos, nodeId: ctx.node.id, retainedDelivered: retained })
      },
    },
    unsubscribe: {
      describe: '取消订阅',
      args: [{ key: 'Topic', label: '主题', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const topic = String(a.Topic || '').trim()
        const before = s.subscriptions.length
        s.subscriptions = s.subscriptions.filter((x) => x.topic !== topic)
        if (s.subscriptions.length === before) return fail(invalid(`not subscribed to "${topic}"`))
        syncBrokerSubs(ctx, s)
        ctx.world.broker.forgetRetained(ctx.node.id, topic)
        return ok(topic)
      },
    },
    list_subscriptions: {
      describe: '列出订阅',
      args: [],
      handler: async (ctx, a, s) => ok(s.subscriptions.map((x) => ({ ...x }))),
    },
    publish: {
      describe: '发布消息（路由到所有匹配订阅的世界节点；Retain 留存最新一条）',
      args: [
        { key: 'Topic', label: '主题', type: 'string', required: true },
        { key: 'Payload', label: '负载', type: 'string' },
        { key: 'Qos', label: 'QoS', type: 'select', options: [0, 1, 2] },
        { key: 'Retain', label: 'Retain', type: 'bool' },
      ],
      handler: async (ctx, a, s) => {
        if (!s.connected) return fail(invalid('not connected'))
        const topic = trimStr(a.Topic)
        // 对齐主仓库 publish：topic 非空、≤65535、禁止 +/# 通配符、Qos ≤ 2
        if (!topic) return fail(invalid('topic empty'))
        if (topic.length > 65535) return fail(invalid('topic too long'))
        if (topic.includes('+') || topic.includes('#')) {
          return fail(invalid('publish topic must not contain wildcards'))
        }
        const payload = String(a.Payload || '')
        const qos = a.Qos !== undefined ? Number(a.Qos) : 0
        if (!Number.isInteger(qos) || qos < 0 || qos > 2) return fail(invalid('invalid qos'))
        const retain = Boolean(a.Retain)
        const delivered = ctx.world.broker.publish(ctx.node.id, topic, payload, qos, retain)
        return ok({ topic, payload, qos, retain, delivered, retained: retain && payload !== '', at: ctx.world.clock.nowIso() })
      },
    },
    // ===== QoS 1/2 投递确认（让 ack 与两阶段去重可被观测） =====
    inflight: {
      describe: '列出未完成的 QoS1/2 投递（await_puback / await_pubrec / await_pubcomp）',
      args: [],
      handler: async (ctx, a, s) => ok(ctx.world.broker.listInflight(ctx.node.id)),
    },
    puback: {
      describe: 'QoS1 确认收到（PUBACK），出清 inflight',
      args: [{ key: 'PacketID', label: '报文 ID', type: 'number', required: true }],
      handler: async (ctx, a, s) => {
        const r = ctx.world.broker.puback(ctx.node.id, Number(a.PacketID))
        if (r.err) return fail(invalid(r.err))
        return ok(r)
      },
    },
    pubrec: {
      describe: 'QoS2 第一阶段应答（PUBREC）：此时才把消息交给应用；重复 PUBREC 只去重不重投',
      args: [{ key: 'PacketID', label: '报文 ID', type: 'number', required: true }],
      handler: async (ctx, a, s) => {
        const r = ctx.world.broker.pubrec(ctx.node.id, Number(a.PacketID))
        if (r.err) return fail(invalid(r.err))
        return ok(r)
      },
    },
    pubcomp: {
      describe: 'QoS2 第二阶段完成（PUBCOMP），出清 inflight',
      args: [{ key: 'PacketID', label: '报文 ID', type: 'number', required: true }],
      handler: async (ctx, a, s) => {
        const r = ctx.world.broker.pubcomp(ctx.node.id, Number(a.PacketID))
        if (r.err) return fail(invalid(r.err))
        return ok(r)
      },
    },
    redeliver: {
      describe: 'QoS1 重传未确认的报文（至少一次语义：允许重复投递）',
      args: [{ key: 'PacketID', label: '报文 ID', type: 'number', required: true }],
      handler: async (ctx, a, s) => {
        const r = ctx.world.broker.redeliver(ctx.node.id, Number(a.PacketID))
        if (r.err) return fail(invalid(r.err))
        return ok(r)
      },
    },
    retained: {
      describe: '列出 Broker 留存的 retain 消息',
      args: [],
      handler: async (ctx) => ok(ctx.world.broker.listRetained()),
    },
    stats: {
      describe: 'Broker 投递统计（各 QoS 计数、ack 计数、去重/重传/留存计数）',
      args: [],
      handler: async (ctx) => ok(JSON.parse(JSON.stringify(ctx.world.broker.stats))),
    },
    drain: {
      describe: '排空订阅队列（给出 Topic 时必须已订阅；QoS1/2 未完成阶段的消息不在此队列）',
      args: [{ key: 'Topic', label: '主题', type: 'string' }],
      handler: async (ctx, a, s) => {
        const topic = a.Topic ? String(a.Topic).trim() : null
        if (topic) {
          const sub = s.subscriptions.find((x) => x.topic === topic)
          if (!sub) return fail(invalid(`not subscribed to "${topic}"`))
        }
        const out = topic
          ? s.inbox.filter((m) => m.topic === topic)
          : [...s.inbox]
        s.inbox = topic ? s.inbox.filter((m) => m.topic !== topic) : []
        return ok(out)
      },
    },
  },
}

// ============================================================
// InfluxDBAbility（依赖 InfluxDBData，模拟时序库）
// ============================================================
export const InfluxDBAbility = {
  name: 'InfluxDBAbility',
  kind: 'ability',
  category: '数据交互',
  describe: 'InfluxDBAbility 提供 InfluxDB 写入/查询/系列管理能力（离线模拟，数据存于节点内存）。',
  deps: ['BaseData', 'InfluxDBData'],
  initState: () => ({ series: {} }),
  commands: {
    set_endpoint: {
      describe: '设置 Endpoint（同步到 InfluxDBData）',
      args: [{ key: 'Endpoint', label: 'Endpoint', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 validateInfluxEndpoint
        const ep = trimStr(a.Endpoint)
        if (!validInfluxEndpoint(ep)) return fail(invalid(`invalid endpoint "${ep}"`))
        ctx.node.data.InfluxDBData.config.endpoint = ep
        return ok(ctx.node.data.InfluxDBData.config.endpoint)
      },
    },
    get_endpoint: {
      describe: '获取 Endpoint',
      args: [],
      handler: async (ctx, a, s) => ok(ctx.node.data.InfluxDBData.config.endpoint || ''),
    },
    set_token: {
      describe: '设置 Token（≥8 字节）',
      args: [{ key: 'Token', label: 'Token', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 isAcceptableSecret：len ≥ 8（旧实现零校验，任意短串即置 hasSecret）
        const tok = String(a.Token ?? '')
        if (tok.length < 8) return fail(invalid('secret too short (min 8 bytes)'))
        ctx.node.data.InfluxDBData.hasSecret = true
        return ok('ok')
      },
    },
    set_org: {
      describe: '设置 Org',
      args: [{ key: 'Org', label: 'Org', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 validateName
        const org = trimStr(a.Org)
        if (!validName(org)) return fail(invalid(`invalid org "${org}"`))
        ctx.node.data.InfluxDBData.config.org = org
        return ok(ctx.node.data.InfluxDBData.config.org)
      },
    },
    set_bucket: {
      describe: '设置 Bucket',
      args: [{ key: 'Bucket', label: 'Bucket', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 validateName
        const bucket = trimStr(a.Bucket)
        if (!validName(bucket)) return fail(invalid(`invalid bucket "${bucket}"`))
        ctx.node.data.InfluxDBData.config.bucket = bucket
        return ok(ctx.node.data.InfluxDBData.config.bucket)
      },
    },
    get_config: {
      describe: '获取配置（不含 Token）',
      args: [],
      handler: async (ctx, a, s) => ok({ ...ctx.node.data.InfluxDBData.config }),
    },
    ping: {
      describe: 'Ping 服务',
      args: [],
      handler: async (ctx, a, s) => {
        if (!ctx.node.data.InfluxDBData.config.endpoint) return fail(invalid('endpoint not configured'))
        return ok({ status: 'ok', endpoint: ctx.node.data.InfluxDBData.config.endpoint })
      },
    },
    write: {
      describe: '写入一行 Line Protocol（measurement,tag=val field=1.0 时间戳）',
      args: [{ key: 'Line', label: 'Line Protocol', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const line = String(a.Line || '').trim()
        const parsed = parseLineProtocol(line)
        if (!parsed) return fail(invalid('invalid line protocol: ' + line))
        // 对齐主仓库 write：measurement ≤128 且字符集合法、fields 1..256
        if (!validIdentifier(parsed.measurement) || parsed.measurement.length > 128) {
          return fail(invalid(`invalid measurement "${parsed.measurement}"`))
        }
        const fieldCount = Object.keys(parsed.fields).length
        if (fieldCount < 1 || fieldCount > 256) return fail(invalid('fields must be 1-256 items'))
        const key = parsed.measurement
        if (!s.series[key]) s.series[key] = { measurement: parsed.measurement, points: [] }
        s.series[key].points.push(parsed)
        return ok({ measurement: parsed.measurement, fields: parsed.fields })
      },
    },
    query: {
      describe: '查询（模拟：返回全部已存点）',
      args: [{ key: 'Query', label: '查询语句', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 query：trim 后必须非空
        const q = trimStr(a.Query)
        if (!q) return fail(invalid('query empty'))
        return ok(Object.values(s.series).map((ser) => ({ measurement: ser.measurement, points: ser.points.length })))
      },
    },
    list_series: {
      describe: '列出全部序列',
      args: [],
      handler: async (ctx, a, s) => ok(Object.keys(s.series)),
    },
    delete_series: {
      describe: '删除序列',
      args: [{ key: 'Measurement', label: 'Measurement', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const m = trimStr(a.Measurement)
        // 对齐主仓库 delete_series：measurement 走 isAcceptableIdentifier
        if (!validIdentifier(m)) return fail(invalid(`invalid measurement "${m}"`))
        if (!(m in s.series)) return fail(invalid(`series "${m}" not found`))
        delete s.series[m]
        return ok(m)
      },
    },
  },
}

function parseLineProtocol(line) {
  // measurement[,tag=val...] field=val[,field=val...] [timestamp]
  const m = line.match(/^([^ ,]+)(?:,([^ ]*))?\s+([^ ]+)(?:\s+(\d+))?$/)
  if (!m) return null
  const tags = {}
  if (m[2]) {
    for (const kv of m[2].split(',')) {
      const [k, v] = kv.split('=')
      tags[k] = v
    }
  }
  const fields = {}
  for (const kv of m[3].split(',')) {
    const [k, v] = kv.split('=')
    fields[k] = v
  }
  return { measurement: m[1], tags, fields, timestamp: m[4] ? Number(m[4]) : Date.now() }
}

// ============================================================
// EKuiperAbility（模拟流/规则引擎）
// ============================================================
// EKuiper URL 校验：http/https、无 userinfo、host 非空、拒绝回环/未指定/组播/链路本地
function validEkuiperEndpoint(url) {
  const s = trimStr(url)
  if (!s) return false
  if (s.includes('#')) return false
  const m = /^(https?):\/\/([^/?#]*)/i.exec(s)
  if (!m) return false
  const hostport = m[2]
  if (!hostport || hostport.includes('@')) return false
  const hp = splitHostPort(hostport)
  const host = hp ? hp.host : stripBrackets(hostport.split(':')[0])
  if (!host) return false
  if (isIpLiteral(host)) return isDialableHost(host, { allowPrivate: true })
  return isAcceptableHostname(host)
}

export const EKuiperAbility = {
  name: 'EKuiperAbility',
  kind: 'ability',
  category: '数据交互',
  describe: 'EKuiperAbility 提供 SQL 流式处理：创建流/规则、启停规则（离线模拟）。',
  deps: ['BaseData'],
  initState: () => ({ endpoint: 'http://127.0.0.1:9081', streams: {}, rules: {} }),
  commands: {
    set_endpoint: {
      describe: '设置 Endpoint（http/https，拒绝回环地址）',
      args: [{ key: 'Endpoint', label: 'Endpoint', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const ep = trimStr(a.Endpoint)
        if (!validEkuiperEndpoint(ep)) return fail(invalid(`invalid endpoint "${ep}"`))
        s.endpoint = ep
        return ok(s.endpoint)
      },
    },
    get_endpoint: {
      describe: '获取 Endpoint',
      args: [],
      handler: async (ctx, a, s) => ok(s.endpoint),
    },
    create_stream: {
      describe: '创建流',
      args: [
        { key: 'Name', label: '流名', type: 'string', required: true },
        { key: 'SQL', label: 'CREATE STREAM 语句', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        const sql = String(a.SQL ?? '')
        // 对齐主仓库 create_stream：name 走 isAcceptableIdentifier、SQL trim 后非空
        if (!validIdentifier(name)) return fail(invalid(`invalid stream name "${name}"`))
        if (!sql.trim()) return fail(invalid('sql empty'))
        if (s.streams[name]) return fail(invalid(`stream "${name}" already exists`))
        s.streams[name] = { name, sql }
        return ok(s.streams[name])
      },
    },
    drop_stream: {
      describe: '删除流',
      args: [{ key: 'Name', label: '流名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        if (!validIdentifier(name)) return fail(invalid(`invalid stream name "${name}"`))
        if (!s.streams[name]) return fail(invalid(`stream "${name}" not found`))
        delete s.streams[name]
        return ok(name)
      },
    },
    list_streams: {
      describe: '列出流',
      args: [],
      handler: async (ctx, a, s) => ok(Object.keys(s.streams)),
    },
    get_stream: {
      describe: '获取流详情',
      args: [{ key: 'Name', label: '流名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        if (!validIdentifier(name)) return fail(invalid(`invalid stream name "${name}"`))
        if (!s.streams[name]) return fail(invalid(`stream "${name}" not found`))
        return ok(s.streams[name])
      },
    },
    create_rule: {
      describe: '创建规则',
      args: [
        { key: 'Name', label: '规则名', type: 'string', required: true },
        { key: 'SQL', label: 'SELECT 语句', type: 'string', required: true },
        { key: 'Actions', label: '动作（JSON）', type: 'json' },
      ],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        const sql = String(a.SQL ?? '')
        if (!validIdentifier(name)) return fail(invalid(`invalid rule name "${name}"`))
        if (!sql.trim()) return fail(invalid('sql empty'))
        if (s.rules[name]) return fail(invalid(`rule "${name}" already exists`))
        s.rules[name] = { name, sql, actions: a.Actions || [], status: 'stopped' }
        return ok(s.rules[name])
      },
    },
    drop_rule: {
      describe: '删除规则',
      args: [{ key: 'Name', label: '规则名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        if (!validIdentifier(name)) return fail(invalid(`invalid rule name "${name}"`))
        if (!s.rules[name]) return fail(invalid(`rule "${name}" not found`))
        delete s.rules[name]
        return ok(name)
      },
    },
    start_rule: {
      describe: '启动规则',
      args: [{ key: 'Name', label: '规则名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        if (!validIdentifier(name)) return fail(invalid(`invalid rule name "${name}"`))
        if (!s.rules[name]) return fail(invalid(`rule "${name}" not found`))
        s.rules[name].status = 'running'
        return ok({ name, status: 'running' })
      },
    },
    stop_rule: {
      describe: '停止规则',
      args: [{ key: 'Name', label: '规则名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        if (!validIdentifier(name)) return fail(invalid(`invalid rule name "${name}"`))
        if (!s.rules[name]) return fail(invalid(`rule "${name}" not found`))
        s.rules[name].status = 'stopped'
        return ok({ name, status: 'stopped' })
      },
    },
    show_rules: {
      describe: '列出全部规则',
      args: [],
      handler: async (ctx, a, s) => ok(Object.values(s.rules)),
    },
    get_rule_status: {
      describe: '获取规则状态',
      args: [{ key: 'Name', label: '规则名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        if (!validIdentifier(name)) return fail(invalid(`invalid rule name "${name}"`))
        if (!s.rules[name]) return fail(invalid(`rule "${name}" not found`))
        return ok({ name, status: s.rules[name].status })
      },
    },
  },
}

// 对齐主仓库：容器 ID/Name 一律经 isValidDockerIDOrName 白名单（拒绝 / \ .. 与 query 分隔符）
function findContainer(s, rawId) {
  const id = trimStr(rawId)
  if (!validDockerIDOrName(id)) return null
  return s.containers.find((x) => x.id === id || x.name === id) || null
}

// ============================================================
// DockerAbility（模拟容器管理）
// ============================================================
export const DockerAbility = {
  name: 'DockerAbility',
  kind: 'ability',
  category: '容器编排',
  describe: 'DockerAbility 提供容器管理：拉取镜像、创建/启停/删除容器、日志（离线模拟）。',
  deps: ['BaseData'],
  initState: () => ({ endpoint: 'unix:///var/run/docker.sock', images: [], containers: [], seq: 1 }),
  commands: {
    set_endpoint: {
      describe: '设置 Endpoint（unix:// 或 tcp/tls://）',
      args: [{ key: 'Endpoint', label: 'Endpoint', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 isValidDockerEndpoint
        const ep = trimStr(a.Endpoint)
        if (!validDockerEndpoint(ep)) return fail(invalid(`invalid endpoint "${ep}"`))
        s.endpoint = ep
        return ok(s.endpoint)
      },
    },
    get_endpoint: {
      describe: '获取 Endpoint',
      args: [],
      handler: async (ctx, a, s) => ok(s.endpoint),
    },
    pull_image: {
      describe: '拉取镜像',
      args: [{ key: 'Image', label: '镜像', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 pull_image：镜像引用必填且走字符白名单（旧实现空串回落 'nginx:latest'）
        const img = trimStr(a.Image)
        if (!validDockerImageRef(img)) return fail(invalid(`invalid image ref "${img}"`))
        if (!s.images.includes(img)) s.images.push(img)
        return ok({ image: img, status: 'pulled' })
      },
    },
    create_container: {
      describe: '创建容器',
      args: [
        { key: 'Name', label: '容器名', type: 'string', required: true },
        { key: 'Image', label: '镜像', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        // 对齐主仓库：image 走镜像引用白名单，name 走 isValidDockerIDOrName
        const name = trimStr(a.Name)
        const img = trimStr(a.Image)
        if (!validDockerIDOrName(name)) return fail(invalid(`invalid container name "${name}"`))
        if (!validDockerImageRef(img)) return fail(invalid(`invalid image ref "${img}"`))
        const c = {
          id: 'ct-' + s.seq++,
          name,
          image: img,
          status: 'created',
          createdAt: Date.now(),
          log: `${name} started (simulated container)\n`,
        }
        s.containers.push(c)
        return ok({ ...c, createdAt: new Date(c.createdAt).toISOString() })
      },
    },
    list_containers: {
      describe: '列出容器',
      args: [],
      handler: async (ctx, a, s) => ok(s.containers.map((c) => ({ ...c, createdAt: new Date(c.createdAt).toISOString() }))),
    },
    start_container: {
      describe: '启动容器',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const c = findContainer(s, a.Id)
        if (!c) return fail(invalid(`container "${a.Id}" not found`))
        c.status = 'running'
        return ok({ id: c.id, status: c.status })
      },
    },
    stop_container: {
      describe: '停止容器',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const c = findContainer(s, a.Id)
        if (!c) return fail(invalid(`container "${a.Id}" not found`))
        c.status = 'stopped'
        return ok({ id: c.id, status: c.status })
      },
    },
    restart_container: {
      describe: '重启容器',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const c = findContainer(s, a.Id)
        if (!c) return fail(invalid(`container "${a.Id}" not found`))
        c.status = 'running'
        return ok({ id: c.id, status: c.status })
      },
    },
    remove_container: {
      describe: '删除容器',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const i = s.containers.findIndex((x) => x.id === a.Id)
        if (i < 0) return fail(invalid(`container "${a.Id}" not found`))
        const [c] = s.containers.splice(i, 1)
        return ok({ id: c.id, removed: true })
      },
    },
    inspect_container: {
      describe: '查看容器详情',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const c = findContainer(s, a.Id)
        if (!c) return fail(invalid(`container "${a.Id}" not found`))
        return ok({ ...c, createdAt: new Date(c.createdAt).toISOString() })
      },
    },
    get_logs: {
      describe: '获取容器日志',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const c = findContainer(s, a.Id)
        if (!c) return fail(invalid(`container "${a.Id}" not found`))
        return ok(c.log || '')
      },
    },
  },
}

// ============================================================
// KubernetesAbility（模拟 K8s 对象）
// ============================================================
export const KubernetesAbility = {
  name: 'KubernetesAbility',
  kind: 'ability',
  category: '容器编排',
  describe: 'KubernetesAbility 提供 Kubernetes 对象管理：apply/delete/list/get/scale/logs（离线模拟）。',
  deps: ['BaseData'],
  initState: () => ({ context: 'sim-cluster', objects: {}, logs: {} }),
  commands: {
    set_context: {
      describe: '设置 KubeContext',
      args: [{ key: 'Context', label: 'Context', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 set_context：Cluster 必填，trim 后非空
        const ctxName = trimStr(a.Context)
        if (!ctxName) return fail(invalid('context empty'))
        s.context = ctxName
        return ok(s.context)
      },
    },
    get_context: {
      describe: '获取 KubeContext',
      args: [],
      handler: async (ctx, a, s) => ok(s.context),
    },
    apply: {
      describe: '应用清单（JSON：kind/metadata.name/spec）',
      args: [{ key: 'Manifest', label: '清单 JSON', type: 'json', required: true }],
      handler: async (ctx, a, s) => {
        const man = a.Manifest
        if (!man || typeof man !== 'object' || !man.kind || !man.metadata?.name) return fail(invalid('manifest must include kind and metadata.name'))
        // 对齐主仓库 apply：Manifest trim 非空且 ≤1MiB；kind/name 走 isValidK8sKind
        const serialized = JSON.stringify(man)
        if (!serialized.trim() || serialized.length > (1 << 20)) return fail(invalid('manifest must be 1-1048576 bytes'))
        const kind = String(man.kind)
        const name = String(man.metadata.name)
        if (!validK8sName(kind) || !validK8sName(name)) return fail(invalid(`invalid kind/name ${kind}/${name}`))
        if (!s.objects[kind]) s.objects[kind] = {}
        s.objects[kind][name] = JSON.parse(JSON.stringify(man))
        if (!s.logs[name]) s.logs[name] = `${name} pod started\n`
        return ok({ kind, name, status: 'applied' })
      },
    },
    delete: {
      describe: '删除对象',
      args: [
        { key: 'Kind', label: 'Kind', type: 'string', required: true },
        { key: 'Name', label: 'Name', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        // 对齐主仓库：Kind/Name 走 isValidK8sKind（白名单是路径穿越的第一道闸）
        const kind = trimStr(a.Kind)
        const name = trimStr(a.Name)
        if (!validK8sName(kind) || !validK8sName(name)) return fail(invalid(`invalid kind/name ${kind}/${name}`))
        if (!s.objects[kind]?.[name]) return fail(invalid(`object ${kind}/${name} not found`))
        delete s.objects[kind][name]
        if (!Object.keys(s.objects[kind]).length) delete s.objects[kind]
        return ok({ kind, name, deleted: true })
      },
    },
    list: {
      describe: '列出对象（按 Kind）',
      args: [{ key: 'Kind', label: 'Kind', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 list：Kind 走 isValidK8sKind（旧实现零校验，非法 Kind 直接返回空列表）
        const kind = trimStr(a.Kind)
        if (!validK8sName(kind)) return fail(invalid(`invalid kind "${kind}"`))
        return ok(Object.values(s.objects[kind] || {}).map((o) => ({ kind: o.kind, name: o.metadata.name, replicas: o.spec?.replicas })))
      },
    },
    get: {
      describe: '获取对象',
      args: [
        { key: 'Kind', label: 'Kind', type: 'string', required: true },
        { key: 'Name', label: 'Name', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        const kind = trimStr(a.Kind)
        const name = trimStr(a.Name)
        if (!validK8sName(kind) || !validK8sName(name)) return fail(invalid(`invalid kind/name ${kind}/${name}`))
        const o = s.objects[kind]?.[name]
        if (!o) return fail(invalid('object not found'))
        return ok(JSON.parse(JSON.stringify(o)))
      },
    },
    scale: {
      describe: '扩缩容 Deployment',
      args: [
        { key: 'Name', label: 'Deployment 名', type: 'string', required: true },
        { key: 'Replicas', label: '副本数', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 scale：Deployment 名走白名单、Replicas ≥ 0
        const name = trimStr(a.Name)
        const replicas = Number(a.Replicas)
        if (!validK8sName(name)) return fail(invalid(`invalid deployment name "${name}"`))
        if (!Number.isInteger(replicas) || replicas < 0) return fail(invalid('replicas must be non-negative'))
        const o = s.objects['Deployment']?.[name]
        if (!o) return fail(invalid(`Deployment "${name}" not found`))
        o.spec = o.spec || {}
        o.spec.replicas = replicas
        return ok({ name, replicas: o.spec.replicas })
      },
    },
    get_logs: {
      describe: '获取 Pod 日志（可选 Tail：只返回最后 N 行）',
      args: [
        { key: 'Name', label: 'Pod 名', type: 'string', required: true },
        { key: 'Tail', label: '末尾行数', type: 'number' },
      ],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 get_logs：Pod 名走白名单、Tail ≥ 0
        const name = trimStr(a.Name)
        if (!validK8sName(name)) return fail(invalid(`invalid pod name "${name}"`))
        const tail = a.Tail !== undefined && a.Tail !== null && a.Tail !== '' ? Number(a.Tail) : null
        if (tail !== null && (!Number.isInteger(tail) || tail < 0)) return fail(invalid('tail must be non-negative'))
        const logs = s.logs[name] || 'no logs'
        if (tail === null || tail === 0) return ok(logs)
        const lines = logs.split(String.fromCharCode(10))
        return ok(lines.slice(Math.max(0, lines.length - tail)).join(String.fromCharCode(10)))
      },
    },
  },
}