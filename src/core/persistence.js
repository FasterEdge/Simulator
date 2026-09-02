// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
import { createWorld, addNode, resetId, setIdCounter } from './world.js'
import { TEMPLATES } from './registry/index.js'

const LS_KEY = 'fasteredge-simulator-v1'

// 把一个世界序列化为可持久化对象（剥离 reactive 代理与函数）
export function serializeWorld(world) {
  return {
    name: world.name,
    clockOffsetMs: world.clockOffsetMs,
    nodes: world.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      template: n.template,
      role: n.role,
      x: n.x,
      y: n.y,
      running: n.running,
      fs: n.fs || {},
      data: JSON.parse(JSON.stringify(n.data || {})),
      abilities: JSON.parse(JSON.stringify(n.abilities || {})),
    })),
    links: world.links.map((l) => ({ id: l.id, source: l.source, target: l.target })),
    scenarios: JSON.parse(JSON.stringify(world.scenarios || [])),
    // 只持久化最近 200 条日志，避免 localStorage 膨胀与每次序列化开销
    logs: (world.logs || []).slice(-200).map((l) => ({
      ts: l.ts, nodeId: l.nodeId, nodeName: l.nodeName, component: l.component, act: l.act,
      value: l.value ?? null, err: l.err || null,
    })),
  }
}

// 从持久化对象重建世界
export function hydrateWorld(obj) {
  resetId()
  const world = createWorld()
  world.name = obj?.name || '未命名编排'
  world.clockOffsetMs = obj?.clockOffsetMs || 0
  // 重建节点
  let maxNodeNum = 0
  for (const n of obj?.nodes || []) {
    const template = TEMPLATES[n.template] || TEMPLATES.custom
    const node = {
      id: n.id,
      name: n.name,
      template: n.template,
      color: n.color || template?.color || '#64748b',
      role: n.role || template?.presetRole || '',
      x: n.x ?? 100,
      y: n.y ?? 100,
      running: n.running !== false,
      data: n.data || {},
      abilities: n.abilities || {},
      fs: n.fs || {},
    }
    world.nodes.push(node)
    // 扫描最大数字后缀，抬升全局 id 计数器，避免新增节点 id 冲突
    const m = /^node-(\d+)$/.exec(n.id)
    if (m) maxNodeNum = Math.max(maxNodeNum, Number(m[1]))
  }
  setIdCounter(maxNodeNum + 1)
  // 步骤归一化：缺 expect/args 时补默认，避免 UI 渲染崩溃
  world.scenarios = (obj?.scenarios || []).map((sc) => ({
    ...sc,
    steps: (sc?.steps || []).map((st) => ({
      ...st,
      args: st.args === undefined ? {} : st.args,
      expect: st.expect || { success: 'any', valueContains: '', errContains: '', valueEquals: '' },
    })),
  }))
  world.logs = (obj?.logs || []).map((l) => ({ ts: l.ts || 0, ...l })).slice(-2000)
  // 重建世界 Broker：连接会话与订阅（跨节点 MQTT 路由依赖它）
  world.broker.clear()
  for (const n of world.nodes) {
    const mqtt = n.abilities?.MQTTAbility
    if (mqtt) {
      if (mqtt.connected) world.broker.connect(n.id, mqtt.broker, mqtt.clientId)
      if (Array.isArray(mqtt.subscriptions) && mqtt.subscriptions.length) {
        world.broker.subs[n.id] = mqtt.subscriptions.map((s) => ({ topic: s.topic, qos: s.qos }))
      }
    }
  }
  return world
}

// localStorage 自动保存/加载；失败时返回 { ok:false, reason }
export function saveToLocal(world) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(serializeWorld(world)))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e?.name || e) }
  }
}

export function loadFromLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return hydrateWorld(JSON.parse(raw))
  } catch (e) {
    return null
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(LS_KEY)
  } catch (e) {
    /* ignore */
  }
}

export function downloadJson(obj, filename = 'topology.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function uploadJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result))
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

// 示例：一个云端 + 两个边缘节点的典型小拓扑
export function buildExampleWorld() {
  const w = createWorld()
  w.name = '示例：边缘云协同'
  const cloud = addNode(w, 'cloud', 'cloud-ctl', 80, 120)
  const edge1 = addNode(w, 'edge', 'edge-01', 380, 60)
  const edge2 = addNode(w, 'edge', 'edge-02', 380, 260)
  w.links.push({ id: 'link-1', source: cloud.id, target: edge1.id })
  w.links.push({ id: 'link-2', source: cloud.id, target: edge2.id })

  // 预置：NetMap 对端 + MQTT 订阅/连接，方便开箱即玩
  const nm1 = edge1.abilities.NetMapAbility
  if (nm1) {
    nm1.peers['cloud-ctl'] = { name: 'cloud-ctl', address: '10.0.0.1:7000', role: 'cloud', lastSeen: Date.now() }
  }
  const mq2 = edge2.abilities.MQTTAbility
  if (mq2) {
    mq2.connected = true
    mq2.subscriptions.push({ topic: 'edge/+/status', qos: 0, nodeId: edge2.id, clientId: mq2.clientId })
    w.broker.connect(edge2.id, mq2.broker, mq2.clientId)
    w.broker.subs[edge2.id] = mq2.subscriptions.map((s) => ({ topic: s.topic, qos: s.qos }))
  }
  const mq1 = edge1.abilities.MQTTAbility
  if (mq1) {
    mq1.connected = true
    w.broker.connect(edge1.id, mq1.broker, mq1.clientId)
  }
  const cloudMq = cloud.abilities.MQTTAbility
  if (cloudMq) {
    cloudMq.connected = true
    w.broker.connect(cloud.id, cloudMq.broker, cloudMq.clientId)
  }
  return w
}
