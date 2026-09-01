import { reactive } from 'vue'
import {
  createWorld,
  addNode,
  removeNode,
  attachComponent,
  detachComponent,
} from './core/world.js'
import { runCommand } from './core/engine.js'
import {
  saveToLocal,
  loadFromLocal,
  buildExampleWorld,
  clearLocal,
  serializeWorld,
  hydrateWorld,
  downloadJson,
  uploadJsonFile,
} from './core/persistence.js'
import { runScenario, sampleScenarios } from './core/testrunner.js'
import { TEMPLATES } from './core/registry/index.js'

export const store = reactive({
  world: createWorld(),
  ui: {
    selectedNodeId: null,
    selectedComponent: null, // 当前选中的组件名（节点面板内）
    view: 'topology', // 'topology' | 'inspector'
    inspectorTab: 'node', // node | console | test
    testTab: 'list', // list | editor
    consoleFilter: '',
    rightOpen: true,
    leftOpen: true,
    exportPngTick: 0, // 递增触发画布导出 PNG
  },
  toasts: [],
})

let _seed = 1
function toast(msg, type = 'info') {
  const id = _seed++
  store.toasts.push({ id, msg, type, at: Date.now() })
  setTimeout(() => {
    const i = store.toasts.findIndex((t) => t.id === id)
    if (i >= 0) store.toasts.splice(i, 1)
  }, 2600)
}

export function initApp() {
  const saved = loadFromLocal()
  if (saved) {
    store.world = saved
  } else {
    const w = buildExampleWorld()
    store.world = w
    saveToLocal(w)
  }
  if (!store.world.scenarios || !store.world.scenarios.length) {
    store.world.scenarios = sampleScenarios()
  }
}

export function resetWorld() {
  clearLocal()
  const w = createWorld()
  w.name = '新拓扑'
  store.world = w
  store.ui.selectedNodeId = null
  store.ui.selectedComponent = null
  saveToLocal(w)
  toast('已新建空拓扑')
}

export function loadExample() {
  clearLocal()
  store.world = buildExampleWorld()
  store.ui.selectedNodeId = null
  saveToLocal(store.world)
  toast('已载入示例拓扑')
}

export function saveWorld(opts = {}) {
  const res = saveToLocal(store.world)
  if (!res.ok) {
    toast(`本地保存失败：${res.reason}（存储可能已满）`, 'error')
  } else if (!opts.silent) {
    toast('已保存到本地')
  }
  return res.ok
}

export function exportWorld() {
  const data = serializeWorld(store.world)
  downloadJson(data, `${store.world.name || 'topology'}.json`)
  toast('已导出 JSON')
}

export async function importWorldFile(file) {
  try {
    const obj = await uploadJsonFile(file)
    store.world = hydrateWorld(obj)
    store.ui.selectedNodeId = null
    toast('已导入拓扑')
  } catch (e) {
    toast(`导入失败: ${e.message}`, 'error')
  }
}

// ===== 拓扑操作 =====
export function addNodeFromTemplate(templateKey, x, y) {
  const node = addNode(store.world, templateKey, '', x, y)
  store.ui.selectedNodeId = node.id
  store.ui.selectedComponent = null
  saveToLocal(store.world)
  return node
}

export function deleteSelectedNode() {
  const id = store.ui.selectedNodeId
  if (!id) return
  removeNode(store.world, id)
  store.ui.selectedNodeId = null
  store.ui.selectedComponent = null
  saveToLocal(store.world)
  toast('已删除节点')
}

export function moveNode(nodeId, x, y) {
  const node = store.world.nodes.find((n) => n.id === nodeId)
  if (node) {
    node.x = x
    node.y = y
  }
}

export function connectNodes(source, target) {
  if (!source || !target || source === target) return
  const exists = store.world.links.some((l) => (l.source === source && l.target === target) || (l.source === target && l.target === source))
  if (exists) return
  store.world.links.push({ id: 'link-' + Math.random().toString(36).slice(2, 8), source, target })
  saveToLocal(store.world)
}

export function removeLink(linkId) {
  store.world.links = store.world.links.filter((l) => l.id !== linkId)
  saveToLocal(store.world)
}

export function updateNodeName(name) {
  const node = selectedNode()
  if (node) {
    node.name = name
    saveToLocal(store.world)
  }
}

export function updateNodeRole(role) {
  const node = selectedNode()
  if (!node) return
  node.role = role
  if (node.abilities.RoleAbility) node.abilities.RoleAbility.role = role
  saveToLocal(store.world)
}

export function toggleNodeRunning() {
  const node = selectedNode()
  if (node) {
    node.running = !node.running
    saveToLocal(store.world)
  }
}

// ===== 组件操作 =====
export function addComponentToNode(compName) {
  const node = selectedNode()
  if (!node) return
  const res = attachComponent(store.world, node.id, compName)
  if (res.err) {
    toast(res.err, 'error')
    return
  }
  store.ui.selectedComponent = compName
  saveToLocal(store.world)
  toast(`已挂载 ${compName}`)
}

export function removeComponentFromNode(compName) {
  const node = selectedNode()
  if (!node) return
  const res = detachComponent(store.world, node.id, compName)
  if (res.err) {
    toast(res.err, 'error')
    return
  }
  if (store.ui.selectedComponent === compName) store.ui.selectedComponent = null
  saveToLocal(store.world)
  toast(`已卸载 ${compName}`)
}

export function selectComponent(name) {
  store.ui.selectedComponent = name
}

// ===== 命令 =====
export function execCommand(nodeId, component, act, args) {
  return runCommand(store.world, nodeId, component, act, args)
}

// ===== 测试 =====
export async function runScenarioOnWorld(scenario, onProgress) {
  const result = await runScenario(store.world, scenario, onProgress)
  saveToLocal(store.world)
  return result
}

export function addScenario() {
  store.world.scenarios.push({
    id: 'sc-' + Math.random().toString(36).slice(2, 8),
    name: '新场景',
    steps: [],
  })
  saveToLocal(store.world)
}

export function removeScenario(scId) {
  store.world.scenarios = store.world.scenarios.filter((s) => s.id !== scId)
  saveToLocal(store.world)
}

export function loadSampleScenarios() {
  store.world.scenarios = sampleScenarios()
  saveToLocal(store.world)
  toast('已载入示例场景')
}

// ===== 选中节点 =====
export function selectedNode() {
  if (!store.ui.selectedNodeId) return null
  return store.world.nodes.find((n) => n.id === store.ui.selectedNodeId) || null
}

export function selectNode(id) {
  store.ui.selectedNodeId = id
  store.ui.selectedComponent = null
  store.ui.view = id ? 'inspector' : 'topology'
  // 点击节点时自动切到"节点"面板
  if (id) store.ui.inspectorTab = 'node'
}

export function toggleLeft() {
  store.ui.leftOpen = !store.ui.leftOpen
}
export function toggleRight() {
  store.ui.rightOpen = !store.ui.rightOpen
}

// 触发画布导出 PNG（TopologyCanvas 监听 tick 执行）
export function requestExportPng() {
  store.ui.exportPngTick++
}

export const templates = TEMPLATES

export { toast }