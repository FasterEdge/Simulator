import { reactive } from 'vue'
import { TEMPLATES, ALL } from './registry/index.js'

// 世界级 MQTT Broker：跨节点消息路由（模拟 Transport）
function createBroker(world) {
  const broker = {
    _world: world,
    sessions: {}, // nodeId -> { broker, clientId }
    subs: {},    // nodeId -> [{ topic, qos }]
    route(fromNodeId, topic, payload, qos, retain) {
      const delivered = []
      for (const [nodeId, subs] of Object.entries(this.subs)) {
        if (nodeId === fromNodeId) continue
        for (const sub of subs) {
          if (topicMatch(sub.topic, topic)) {
            const node = this._world?.nodes?.find((n) => n.id === nodeId)
            const mqtt = node?.abilities?.MQTTAbility
            if (mqtt && mqtt.connected) {
              mqtt.inbox.push({ topic, payload, qos, retain, from: fromNodeId, at: new Date().toISOString() })
              // 队列上限（drop-oldest），避免无限增长
              if (mqtt.inbox.length > 256) mqtt.inbox.splice(0, mqtt.inbox.length - 256)
              delivered.push({ nodeId, topic: sub.topic })
            }
            break
          }
        }
      }
      return delivered.length
    },
    publish(fromNodeId, topic, payload, qos, retain) {
      return this.route(fromNodeId, topic, payload, qos, retain)
    },
    connect(nodeId, broker, clientId) {
      this.sessions[nodeId] = { broker, clientId }
    },
    disconnect(nodeId) {
      delete this.sessions[nodeId]
      delete this.subs[nodeId]
    },
    clear() {
      this.sessions = {}
      this.subs = {}
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
    selectedNodeId: null,
    selectedComponent: null,
    scenarios: [],
  })
  world.broker = createBroker(world)
  world.logCommand = (entry) => logCommand(world, entry)
  return world
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
    ts: Date.now(),
    ...entry,
  })
  if (world.logs.length > 3000) world.logs.splice(0, world.logs.length - 3000)
}