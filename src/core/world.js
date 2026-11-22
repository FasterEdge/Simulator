// ─────────────────────────────────────────────────────────────
// FasterEdge 开源项目
// Github: https://github.com/FasterEdge
// Gitee:  https://gitee.com/FasterEdge
// ─────────────────────────────────────────────────────────────
import { reactive, markRaw } from 'vue'
import { TEMPLATES, ALL } from './registry/index.js'
import { createClock } from './clock.js'

const MAX_INBOX = 256

const clampQos = (q) => {
  const n = Number(q)
  if (!Number.isFinite(n)) return 0
  return Math.min(2, Math.max(0, Math.trunc(n)))
}

function newBrokerStats() {
  return {
    published: 0, delivered: 0, dropped: 0,
    puback: 0, pubrec: 0, pubcomp: 0, deduped: 0, redelivered: 0,
    retainedStored: 0, retainedDelivered: 0,
    byQos: { 0: 0, 1: 0, 2: 0 },
  }
}

// 世界级 MQTT Broker：跨节点消息路由（模拟 Transport）
// 投递语义（对齐 MQTT 3.1.1 的可观测子集）：
// - 有效 QoS = min(发布 QoS, 订阅 QoS)
// - QoS 0：至多一次，直接入 inbox，无 ack
// - QoS 1：至少一次，入 inbox 并登记 inflight(await_puback)，puback 后才出清；redeliver 模拟重传
// - QoS 2：恰好一次，分两阶段——PUBREC 前不投递给应用；PUBREC 后入 inbox 并转 await_pubcomp，
//          重复 PUBREC 不再投递（deduped 计数），PUBCOMP 才出清
// - retain：publish 带 retain=true 时留存该主题最新消息，后续订阅（或重连）补投；空 payload 清除留存
function createBroker(world) {
  const broker = {
    _world: world,
    sessions: {},     // nodeId -> { broker, clientId }
    subs: {},         // nodeId -> [{ topic, qos }]
    retained: {},     // topic -> { topic, payload, qos, from, at }
    retainedSeen: {}, // nodeId -> { topic: true }（避免重连重复补投）
    inflight: {},     // nodeId -> { packetId: { packetId, topic, payload, qos, stage } }
    stats: newBrokerStats(),
    packetSeq: 1,

    nextPacketId() {
      const id = this.packetSeq++
      if (this.packetSeq > 1e9) this.packetSeq = 1
      return id
    },

    _node(nodeId) {
      return this._world?.nodes?.find((n) => n.id === nodeId) || null
    },

    _mqtt(nodeId) {
      const mqtt = this._node(nodeId)?.abilities?.MQTTAbility
      return mqtt && mqtt.connected ? mqtt : null
    },

    _push(mqtt, message) {
      mqtt.inbox.push(message)
      // 队列上限（drop-oldest），避免无限增长
      if (mqtt.inbox.length > MAX_INBOX) {
        const dropped = mqtt.inbox.length - MAX_INBOX
        mqtt.inbox.splice(0, dropped)
        this.stats.dropped += dropped
      }
    },

    _deliver(nodeId, mqtt, msg, effQos, opts = {}) {
      const packetId = this.nextPacketId()
      const at = this._world?.clock ? this._world.clock.nowIso() : new Date().toISOString()
      const message = {
        topic: msg.topic,
        payload: msg.payload,
        qos: effQos,
        packetId,
        retain: Boolean(opts.retained),
        from: msg.from,
        at,
      }
      this.stats.byQos[effQos] = (this.stats.byQos[effQos] || 0) + 1
      if (effQos === 0) {
        this._push(mqtt, message)
        return message
      }
      const box = this.inflight[nodeId] || (this.inflight[nodeId] = {})
      if (effQos === 1) {
        this._push(mqtt, message)
        box[packetId] = { ...message, stage: 'await_puback' }
        return message
      }
      // QoS 2：扇形入库前先只登记，等 PUBREC 再交给应用
      box[packetId] = { ...message, stage: 'await_pubrec' }
      return message
    },

    route(fromNodeId, topic, payload, qos, retain) {
      const q = clampQos(qos)
      const delivered = []
      this.stats.published++
      // retain 语义：留存最新一条（空 payload = 清除留存，对齐 MQTT 3.1.1）
      if (retain) {
        if (payload === '' || payload === null || payload === undefined) {
          if (this.retained[topic]) {
            delete this.retained[topic]
            // 已清除留存的订阅者下次可重新收到回归的留存消息
            for (const k of Object.keys(this.retainedSeen)) delete this.retainedSeen[k][topic]
          }
        } else {
          this.retained[topic] = {
            topic,
            payload: String(payload),
            qos: q,
            from: fromNodeId,
            at: this._world?.clock ? this._world.clock.nowIso() : new Date().toISOString(),
          }
          this.stats.retainedStored++
        }
      }
      for (const [nodeId, subs] of Object.entries(this.subs)) {
        if (nodeId === fromNodeId) continue
        const matched = bestSubscription(subs, topic)
        if (!matched) continue
        const mqtt = this._mqtt(nodeId)
        if (!mqtt) continue
        const effQos = Math.min(q, clampQos(matched.qos))
        this._deliver(nodeId, mqtt, { topic, payload, from: fromNodeId }, effQos)
        delivered.push({ nodeId, topic: matched.topic, qos: effQos })
      }
      this.stats.delivered += delivered.length
      return delivered.length
    },

    // 把留存消息补给该节点：订阅/重连时调用（与本节点订阅 filter 匹配且此前未补投过）
    deliverRetained(nodeId) {
      const subs = this.subs[nodeId] || []
      const mqtt = this._mqtt(nodeId)
      if (!mqtt || !subs.length) return 0
      const seen = this.retainedSeen[nodeId] || (this.retainedSeen[nodeId] = {})
      let n = 0
      for (const [topic, rec] of Object.entries(this.retained)) {
        if (seen[topic]) continue
        const sub = bestSubscription(subs, topic)
        if (!sub) continue
        const effQos = Math.min(clampQos(rec.qos), clampQos(sub.qos))
        this._deliver(nodeId, mqtt, { topic, payload: rec.payload, from: rec.from }, effQos, { retained: true })
        seen[topic] = true
        n++
      }
      this.stats.retainedDelivered += n
      return n
    },

    listRetained() {
      return Object.values(this.retained).map((r) => ({ ...r }))
    },

    listInflight(nodeId) {
      const box = this.inflight[nodeId] || {}
      return Object.values(box).map((r) => ({
        packetId: r.packetId, topic: r.topic, qos: r.qos, stage: r.stage,
      }))
    },

    // QoS 1 PUBACK：出清 inflight
    puback(nodeId, packetId) {
      const box = this.inflight[nodeId] || {}
      const rec = box[packetId]
      if (!rec) return { err: `packet ${packetId} is not in flight` }
      if (rec.stage !== 'await_puback') return { err: `packet ${packetId} is not awaiting PUBACK (stage=${rec.stage})` }
      delete box[packetId]
      this.stats.puback++
      return { packetId, topic: rec.topic, acked: true, stage: 'done' }
    },

    // QoS 2 第一阶段 PUBREC：交给应用并转 await_pubcomp；重复 PUBREC 只记 deduped 不重复投递
    pubrec(nodeId, packetId) {
      const box = this.inflight[nodeId] || {}
      const rec = box[packetId]
      if (!rec) return { err: `packet ${packetId} is not in flight` }
      if (rec.stage === 'await_pubcomp') {
        this.stats.deduped++
        return { packetId, topic: rec.topic, stage: 'await_pubcomp', duplicate: true, delivered: false }
      }
      if (rec.stage !== 'await_pubrec') return { err: `packet ${packetId} is not awaiting PUBREC (stage=${rec.stage})` }
      rec.stage = 'await_pubcomp'
      this.stats.pubrec++
      const mqtt = this._mqtt(nodeId)
      if (mqtt) {
        this._push(mqtt, {
          topic: rec.topic, payload: rec.payload, qos: 2, packetId, retain: false, from: rec.from, at: rec.at, stage: 'await_pubcomp',
        })
      }
      return { packetId, topic: rec.topic, stage: 'await_pubcomp', duplicate: false, delivered: Boolean(mqtt) }
    },

    // QoS 2 第二阶段 PUBCOMP：出清 inflight
    pubcomp(nodeId, packetId) {
      const box = this.inflight[nodeId] || {}
      const rec = box[packetId]
      if (!rec) return { err: `packet ${packetId} is not in flight` }
      if (rec.stage !== 'await_pubcomp') return { err: `packet ${packetId} has not completed the PUBREC phase (stage=${rec.stage})` }
      delete box[packetId]
      this.stats.pubcomp++
      return { packetId, topic: rec.topic, released: true, stage: 'done' }
    },

    // QoS 1 至少一次：未 ack 前允许重传（重复投递是可观测的）
    redeliver(nodeId, packetId) {
      const box = this.inflight[nodeId] || {}
      const rec = box[packetId]
      if (!rec) return { err: `packet ${packetId} is not in flight` }
      if (rec.stage !== 'await_puback') return { err: `packet ${packetId} is not awaiting PUBACK (stage=${rec.stage})` }
      const mqtt = this._mqtt(nodeId)
      if (!mqtt) return { err: 'not connected' }
      this._push(mqtt, {
        topic: rec.topic, payload: rec.payload, qos: 1, packetId, retain: false, from: rec.from, at: rec.at, duplicate: true,
      })
      this.stats.redelivered++
      return { packetId, topic: rec.topic, duplicate: true }
    },

    publish(fromNodeId, topic, payload, qos, retain) {
      return this.route(fromNodeId, topic, payload, qos, retain)
    },
    connect(nodeId, broker, clientId) {
      this.sessions[nodeId] = { broker, clientId }
      this.deliverRetained(nodeId)
    },
    disconnect(nodeId) {
      delete this.sessions[nodeId]
      delete this.subs[nodeId]
      delete this.retainedSeen[nodeId]
      delete this.inflight[nodeId]
    },
    // 取消某条订阅：清掉对应留存补投标记，重订阅可再次收到留存
    forgetRetained(nodeId, topic) {
      const seen = this.retainedSeen[nodeId]
      if (!seen) return
      for (const t of Object.keys(seen)) {
        if (t === topic || topicMatch(topic, t) || topicMatch(t, topic)) delete seen[t]
      }
    },
    clear() {
      this.sessions = {}
      this.subs = {}
      this.retained = {}
      this.retainedSeen = {}
      this.inflight = {}
      this.stats = newBrokerStats()
      this.packetSeq = 1
    },
    // hydrate 用：恢复 broker 运行时状态（packetSeq / 留存消息 / inflight 队列 / 统计 / 补投标记），
    // 使跨节点 MQTT 行为在序列化→反序列化后可复现（packetId 连续、留存不重复补投）
    restore(snap) {
      const s = snap && typeof snap === 'object' ? snap : {}
      const clean = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
      this.sessions = clean(s.sessions)
      this.subs = clean(s.subs)
      this.retained = clean(s.retained)
      this.retainedSeen = clean(s.retainedSeen)
      this.inflight = clean(s.inflight)
      this.stats = { ...newBrokerStats(), ...clean(s.stats) }
      // byQos 是固定形状的计数表，逐键恢复避免旧文件缺字段
      this.stats.byQos = { 0: 0, 1: 0, 2: 0, ...clean(this.stats.byQos) }
      this.packetSeq = Number.isFinite(Number(s.packetSeq)) && Number(s.packetSeq) >= 1 ? Number(s.packetSeq) : 1
      return this.snapshot()
    },
    // 可持久化快照：只含纯数据，剥离函数与 reactive 代理
    snapshot() {
      return {
        sessions: JSON.parse(JSON.stringify(this.sessions)),
        subs: JSON.parse(JSON.stringify(this.subs)),
        retained: JSON.parse(JSON.stringify(this.retained)),
        retainedSeen: JSON.parse(JSON.stringify(this.retainedSeen)),
        inflight: JSON.parse(JSON.stringify(this.inflight)),
        stats: JSON.parse(JSON.stringify(this.stats)),
        packetSeq: this.packetSeq,
      }
    },
  }
  return broker
}

// MQTT 通配符匹配
export function topicMatch(pattern, topic) {
  const p = pattern.split('/')
  const t = topic.split('/')
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]
    if (seg === '#') return true
    if (i >= t.length) return false
    if (seg === '+') continue
    if (seg !== t[i]) return false
  }
  return p.length === t.length
}

// 订阅过滤器特异度：精确层级计 3，'+' 计 2，'#' 计 1。
// 同一 topic 命中多条订阅时，MQTT 规定取"最具体"的那条决定有效 QoS（§4.7 重叠订阅）。
function filterSpecificity(pattern) {
  return pattern.split('/').reduce((acc, seg) => (seg === '#' ? acc + 1 : seg === '+' ? acc + 2 : acc + 3), 0)
}

// 在订阅集合里挑最匹配的一条（特异度最高）；无匹配返回 null
export function bestSubscription(subs, topic) {
  let best = null
  let bestScore = -1
  for (const sub of subs || []) {
    if (!topicMatch(sub.topic, topic)) continue
    const score = filterSpecificity(sub.topic)
    if (score > bestScore) {
      best = sub
      bestScore = score
    }
  }
  return best
}

let uid = 1
export const nextId = (prefix) => `${prefix}${uid++}`

export function resetId() {
  uid = 1
}

// 把全局 id 计数器抬到至少 n（加载持久化世界后避免 id 冲突）
export function setIdCounter(n) {
  if (typeof n === 'number' && n > uid) uid = n
}

export function createWorld() {
  const world = reactive({
    name: '未命名编排',
    clockOffsetMs: 0,
    nodes: [],
    links: [],
    logs: [],
    broker: null,
    clock: null,
    selectedNodeId: null,
    selectedComponent: null,
    scenarios: [],
  })
  world.broker = markRaw(createBroker(world))
  // 世界时钟：offset 生效于引擎全部时间戳（日志、传输记录、TimeAbility.get_time）
  // markRaw 避免 reactive 代理包裹时钟内部方法（时钟状态在闭包里，代理没有意义）
  world.clock = markRaw(createClock(world))
  world.now = () => world.clock.now()
  world.logCommand = (entry) => logCommand(world, entry)
  return world
}

// 统一取"世界时间"（模拟时钟）；缺时钟时退回系统时间
export function worldNow(world) {
  return world?.clock ? world.clock.now() : Date.now()
}

export function worldNowIso(world) {
  return world?.clock ? world.clock.nowIso() : new Date().toISOString()
}

// ── 拓扑连通性：world.links 是无向边，BFS 求最短跳数路径 ──
// 返回节点 id 数组（含首尾），不连通返回 null；起点=终点返回 [a]
export function topologyPath(world, fromId, toId) {
  if (!fromId || !toId) return null
  if (fromId === toId) return [fromId]
  const adj = new Map()
  for (const l of world?.links || []) {
    if (!adj.has(l.source)) adj.set(l.source, [])
    if (!adj.has(l.target)) adj.set(l.target, [])
    adj.get(l.source).push(l.target)
    adj.get(l.target).push(l.source)
  }
  if (!adj.has(fromId) || !adj.has(toId)) return null
  const prev = new Map([[fromId, null]])
  const queue = [fromId]
  while (queue.length) {
    const cur = queue.shift()
    if (cur === toId) {
      const path = []
      for (let k = cur; k !== null; k = prev.get(k)) path.unshift(k)
      return path
    }
    for (const nxt of adj.get(cur) || []) {
      if (prev.has(nxt)) continue
      prev.set(nxt, cur)
      queue.push(nxt)
    }
  }
  return null
}

export function topologyConnected(world, fromId, toId) {
  return topologyPath(world, fromId, toId) !== null
}

export function createState(def) {
  try {
    return def.initState ? def.initState() : {}
  } catch (e) {
    return {}
  }
}

export function addNode(world, templateKey, name, x, y) {
  const tpl = TEMPLATES[templateKey] || TEMPLATES.custom
  const id = nextId('node-')
  const safeName = name || `${tpl.label} ${world.nodes.length + 1}`
  const node = {
    id,
    name: safeName,
    template: tpl.name,
    color: tpl.color,
    role: tpl.presetRole || '',
    x,
    y,
    running: true,
    data: {},
    abilities: {},
    fs: {
      '/etc/hostname': `${safeName}\n`,
      '/etc/os-release': 'NAME="FasterEdgeOS"\nVERSION="1.0-sim"\n',
    },
  }
  for (const d of tpl.data) {
    const def = ALL[d]
    node.data[d] = def ? createState(def) : {}
  }
  for (const a of tpl.abilities) {
    const def = ALL[a]
    node.abilities[a] = def ? createState(def) : {}
  }
  // 模板预设角色写入 RoleAbility，便于 Cloud/EdgeRoleAbility 依赖检查
  if (tpl.presetRole && node.abilities.RoleAbility) node.abilities.RoleAbility.role = tpl.presetRole
  world.nodes.push(node)
  return node
}

export function removeNode(world, nodeId) {
  world.broker.disconnect(nodeId)
  world.nodes = world.nodes.filter((n) => n.id !== nodeId)
  world.links = world.links.filter((l) => l.source !== nodeId && l.target !== nodeId)
  if (world.selectedNodeId === nodeId) world.selectedNodeId = null
}

export function attachComponent(world, nodeId, compName) {
  const node = world.nodes.find((n) => n.id === nodeId)
  if (!node) return { err: 'node not found' }
  const def = ALL[compName]
  if (!def) return { err: `component "${compName}" not registered` }
  const target = def.kind === 'ability' ? node.abilities : node.data
  if (target[compName] !== undefined) return { err: 'duplicate component' }
  // 自动补齐缺失依赖（Data 与 Ability 都补，递归处理，带环检测）
  const visiting = new Set()
  const autoAttach = (name) => {
    const d = ALL[name]
    if (!d) return
    const dest = d.kind === 'ability' ? node.abilities : node.data
    if (dest[name] !== undefined) return
    if (visiting.has(name)) return // 循环依赖保护
    visiting.add(name)
    for (const dep of d.deps || []) autoAttach(dep)
    visiting.delete(name)
    dest[name] = createState(d)
  }
  autoAttach(compName)
  return { ok: true, def }
}

export function detachComponent(world, nodeId, compName) {
  const node = world.nodes.find((n) => n.id === nodeId)
  if (!node) return { err: 'node not found' }
  const def = ALL[compName]
  if (def && def.kind === 'ability') {
    // 卸载 MQTTAbility 时同步断开世界 Broker，避免订阅/会话残留
    if (compName === 'MQTTAbility') world.broker.disconnect(nodeId)
    delete node.abilities[compName]
  } else if (def) delete node.data[compName]
  else {
    if (node.abilities[compName] !== undefined) delete node.abilities[compName]
    if (node.data[compName] !== undefined) delete node.data[compName]
  }
  return { ok: true }
}

export function nodeComponents(node) {
  return {
    data: Object.keys(node.data || {}),
    abilities: Object.keys(node.abilities || {}),
  }
}

// 记录一次命令执行到控制台
export function logCommand(world, entry) {
  world.logs.push({
    ts: worldNow(world),
    ...entry,
  })
  if (world.logs.length > 3000) world.logs.splice(0, world.logs.length - 3000)
}
