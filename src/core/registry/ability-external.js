import { ok, fail, invalid } from '../errors.js'
import { randomToken } from '../crypto.js'

// 可接受的 Broker scheme（对齐主仓库），拒绝 localhost/私网地址
const BROKER_SCHEMES = ['tcp', 'tls', 'ssl', 'ws', 'wss']
function validBrokerURL(url) {
  if (typeof url !== 'string' || !url) return false
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)/.exec(url)
  if (!m) return false
  if (!BROKER_SCHEMES.includes(m[1].toLowerCase())) return false
  const hostport = m[2]
  if (!hostport) return false
  const host = hostport.split(':')[0]
  if (!host || /^(localhost|127\.|0\.0\.0\.0|::1)/.test(host)) return false
  return true
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
        const url = String(a.URL).trim()
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
      handler: async (ctx, a, s) => { s.clientId = String(a.ClientID).trim(); return ok(s.clientId) },
    },
    connect: {
      describe: '连接 Broker（在世界 Broker 注册）',
      args: [],
      handler: async (ctx, a, s) => {
        ctx.world.broker.connect(ctx.node.id, s.broker, s.clientId)
        s.connected = true
        syncBrokerSubs(ctx, s)
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
      describe: '订阅主题（支持 + / # 通配符）',
      args: [
        { key: 'Topic', label: '主题', type: 'string', required: true },
        { key: 'Qos', label: 'QoS', type: 'select', options: [0, 1, 2] },
      ],
      handler: async (ctx, a, s) => {
        const topic = String(a.Topic || '').trim()
        if (!topic) return fail(invalid('topic empty'))
        const qos = a.Qos !== undefined ? Number(a.Qos) : 0
        const sub = { topic, qos, nodeId: ctx.node.id, clientId: s.clientId }
        const existing = s.subscriptions.find((x) => x.topic === topic)
        if (existing) existing.qos = qos
        else s.subscriptions.push(sub)
        syncBrokerSubs(ctx, s)
        return ok({ topic, qos, nodeId: ctx.node.id })
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
        return ok(topic)
      },
    },
    list_subscriptions: {
      describe: '列出订阅',
      args: [],
      handler: async (ctx, a, s) => ok(s.subscriptions.map((x) => ({ ...x }))),
    },
    publish: {
      describe: '发布消息（路由到所有匹配订阅的世界节点）',
      args: [
        { key: 'Topic', label: '主题', type: 'string', required: true },
        { key: 'Payload', label: '负载', type: 'string' },
        { key: 'Qos', label: 'QoS', type: 'select', options: [0, 1, 2] },
        { key: 'Retain', label: 'Retain', type: 'bool' },
      ],
      handler: async (ctx, a, s) => {
        if (!s.connected) return fail(invalid('not connected'))
        const topic = String(a.Topic || '').trim()
        if (!topic) return fail(invalid('topic empty'))
        const payload = String(a.Payload || '')
        const qos = a.Qos !== undefined ? Number(a.Qos) : 0
        const retain = Boolean(a.Retain)
        const delivered = ctx.world.broker.publish(ctx.node.id, topic, payload, qos, retain)
        return ok({ topic, payload, qos, retain, delivered, at: new Date().toISOString() })
      },
    },
    drain: {
      describe: '排空订阅队列（给出 Topic 时必须已订阅）',
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
        ctx.node.data.InfluxDBData.config.endpoint = String(a.Endpoint).trim()
        return ok(ctx.node.data.InfluxDBData.config.endpoint)
      },
    },
    get_endpoint: {
      describe: '获取 Endpoint',
      args: [],
      handler: async (ctx, a, s) => ok(ctx.node.data.InfluxDBData.config.endpoint || ''),
    },
    set_token: {
      describe: '设置 Token',
      args: [{ key: 'Token', label: 'Token', type: 'string', required: true }],
      handler: async (ctx, a, s) => { ctx.node.data.InfluxDBData.hasSecret = true; return ok('ok') },
    },
    set_org: {
      describe: '设置 Org',
      args: [{ key: 'Org', label: 'Org', type: 'string', required: true }],
      handler: async (ctx, a, s) => { ctx.node.data.InfluxDBData.config.org = String(a.Org).trim(); return ok(ctx.node.data.InfluxDBData.config.org) },
    },
    set_bucket: {
      describe: '设置 Bucket',
      args: [{ key: 'Bucket', label: 'Bucket', type: 'string', required: true }],
      handler: async (ctx, a, s) => { ctx.node.data.InfluxDBData.config.bucket = String(a.Bucket).trim(); return ok(ctx.node.data.InfluxDBData.config.bucket) },
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
        const key = parsed.measurement
        if (!s.series[key]) s.series[key] = { measurement: parsed.measurement, points: [] }
        s.series[key].points.push(parsed)
        return ok({ measurement: parsed.measurement, fields: parsed.fields })
      },
    },
    query: {
      describe: '查询（模拟：返回全部已存点）',
      args: [{ key: 'Query', label: '查询语句', type: 'string' }],
      handler: async (ctx, a, s) => ok(Object.values(s.series).map((ser) => ({ measurement: ser.measurement, points: ser.points.length }))),
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
        const m = String(a.Measurement).trim()
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
export const EKuiperAbility = {
  name: 'EKuiperAbility',
  kind: 'ability',
  category: '数据交互',
  describe: 'EKuiperAbility 提供 SQL 流式处理：创建流/规则、启停规则（离线模拟）。',
  deps: ['BaseData'],
  initState: () => ({ endpoint: 'http://127.0.0.1:9081', streams: {}, rules: {} }),
  commands: {
    set_endpoint: {
      describe: '设置 Endpoint',
      args: [{ key: 'Endpoint', label: 'Endpoint', type: 'string', required: true }],
      handler: async (ctx, a, s) => { s.endpoint = String(a.Endpoint).trim(); return ok(s.endpoint) },
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
        const name = String(a.Name).trim()
        if (s.streams[name]) return fail(invalid(`stream "${name}" already exists`))
        s.streams[name] = { name, sql: String(a.SQL) }
        return ok(s.streams[name])
      },
    },
    drop_stream: {
      describe: '删除流',
      args: [{ key: 'Name', label: '流名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = String(a.Name).trim()
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
        const name = String(a.Name).trim()
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
        const name = String(a.Name).trim()
        if (s.rules[name]) return fail(invalid(`rule "${name}" already exists`))
        s.rules[name] = { name, sql: String(a.SQL), actions: a.Actions || [], status: 'stopped' }
        return ok(s.rules[name])
      },
    },
    drop_rule: {
      describe: '删除规则',
      args: [{ key: 'Name', label: '规则名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = String(a.Name).trim()
        if (!s.rules[name]) return fail(invalid(`rule "${name}" not found`))
        delete s.rules[name]
        return ok(name)
      },
    },
    start_rule: {
      describe: '启动规则',
      args: [{ key: 'Name', label: '规则名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = String(a.Name).trim()
        if (!s.rules[name]) return fail(invalid(`rule "${name}" not found`))
        s.rules[name].status = 'running'
        return ok({ name, status: 'running' })
      },
    },
    stop_rule: {
      describe: '停止规则',
      args: [{ key: 'Name', label: '规则名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = String(a.Name).trim()
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
        const name = String(a.Name).trim()
        if (!s.rules[name]) return fail(invalid(`rule "${name}" not found`))
        return ok({ name, status: s.rules[name].status })
      },
    },
  },
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
      describe: '设置 Endpoint',
      args: [{ key: 'Endpoint', label: 'Endpoint', type: 'string', required: true }],
      handler: async (ctx, a, s) => { s.endpoint = String(a.Endpoint).trim(); return ok(s.endpoint) },
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
        const img = String(a.Image).trim() || 'nginx:latest'
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
        const name = String(a.Name).trim()
        const img = String(a.Image).trim()
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
        const c = s.containers.find((x) => x.id === a.Id)
        if (!c) return fail(invalid(`container "${a.Id}" not found`))
        c.status = 'running'
        return ok({ id: c.id, status: c.status })
      },
    },
    stop_container: {
      describe: '停止容器',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const c = s.containers.find((x) => x.id === a.Id)
        if (!c) return fail(invalid(`container "${a.Id}" not found`))
        c.status = 'stopped'
        return ok({ id: c.id, status: c.status })
      },
    },
    restart_container: {
      describe: '重启容器',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const c = s.containers.find((x) => x.id === a.Id)
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
        const c = s.containers.find((x) => x.id === a.Id)
        if (!c) return fail(invalid(`container "${a.Id}" not found`))
        return ok({ ...c, createdAt: new Date(c.createdAt).toISOString() })
      },
    },
    get_logs: {
      describe: '获取容器日志',
      args: [{ key: 'Id', label: '容器 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const c = s.containers.find((x) => x.id === a.Id)
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
      handler: async (ctx, a, s) => { s.context = String(a.Context).trim(); return ok(s.context) },
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
        const kind = String(man.kind)
        const name = String(man.metadata.name)
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
        const kind = String(a.Kind)
        const name = String(a.Name)
        if (!s.objects[kind]?.[name]) return fail(invalid(`object ${kind}/${name} not found`))
        delete s.objects[kind][name]
        if (!Object.keys(s.objects[kind]).length) delete s.objects[kind]
        return ok({ kind, name, deleted: true })
      },
    },
    list: {
      describe: '列出对象（按 Kind）',
      args: [{ key: 'Kind', label: 'Kind', type: 'string', required: true }],
      handler: async (ctx, a, s) => ok(Object.values(s.objects[String(a.Kind)] || {}).map((o) => ({ kind: o.kind, name: o.metadata.name, replicas: o.spec?.replicas }))),
    },
    get: {
      describe: '获取对象',
      args: [
        { key: 'Kind', label: 'Kind', type: 'string', required: true },
        { key: 'Name', label: 'Name', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        const o = s.objects[String(a.Kind)]?.[String(a.Name)]
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
        const o = s.objects['Deployment']?.[String(a.Name)]
        if (!o) return fail(invalid(`Deployment "${a.Name}" not found`))
        o.spec = o.spec || {}
        o.spec.replicas = Number(a.Replicas)
        return ok({ name: a.Name, replicas: o.spec.replicas })
      },
    },
    get_logs: {
      describe: '获取 Pod 日志',
      args: [{ key: 'Name', label: 'Pod 名', type: 'string', required: true }],
      handler: async (ctx, a, s) => ok(s.logs[String(a.Name)] || 'no logs'),
    },
  },
}