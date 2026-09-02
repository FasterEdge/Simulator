<script setup>

// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
import { ref, watch, onMounted, markRaw, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { toPng } from 'html-to-image'
import { store, addNodeFromTemplate, connectNodes, removeLink, moveNode, selectNode, toast } from '../store.js'
import SimNode from './SimNode.vue'

const nodes = ref([])
const edges = ref([])
const nodeTypes = { sim: markRaw(SimNode) }
const canvasRef = ref(null)
const { screenToFlowCoordinate, onConnect: flowOnConnect, fitView, setViewport, viewport } = useVueFlow()

// 记录当前 world 引用：仅当整体替换（加载/导入/示例）时触发 fitView
let _lastWorld = null

function syncFromWorld() {
  nodes.value = store.world.nodes.map((n) => ({
    id: n.id,
    type: 'sim',
    position: { x: n.x, y: n.y },
    data: { nodeId: n.id },
  }))
  edges.value = store.world.links.map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    animated: false,
    style: { stroke: '#3d5075', strokeWidth: 2 },
  }))
}

watch(
  () => [store.world, store.world?.nodes.length, store.world?.links.length],
  async () => {
    if (store.world) {
      syncFromWorld()
      if (_lastWorld !== store.world) {
        _lastWorld = store.world
        await nextTick()
        fitView({ padding: 0.15, duration: 0, maxZoom: 1.5 })
      }
    }
  },
  { deep: false }
)

onMounted(() => {
  if (store.world) syncFromWorld()
})

// ===== 导出完整画布 PNG =====
async function exportPng() {
  const wrap = canvasRef.value
  if (!wrap) return
  if (!store.world?.nodes?.length) {
    toast('画布为空，无可导出内容', 'error')
    return
  }
  const flowEl = wrap.querySelector('.vue-flow')
  if (!flowEl) return
  const hint = wrap.querySelector('.canvas-hint')
  const prev = { ...(viewport.value || { x: 0, y: 0, zoom: 1 }) }
  try {
    if (hint) hint.style.display = 'none'
    // 先缩放到完整拓扑，再截图
    await fitView({ padding: 0.15, duration: 0, maxZoom: 1.5 })
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    await new Promise((r) => setTimeout(r, 60))
    const dataUrl = await toPng(flowEl, {
      pixelRatio: 2,
      backgroundColor: '#0a0e17',
      cacheBust: true,
      filter: (node) =>
        !node.classList?.contains('vue-flow__minimap') &&
        !node.classList?.contains('vue-flow__controls') &&
        !node.classList?.contains('vue-flow__attribution'),
    })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${store.world?.name || 'topology'}-${Date.now()}.png`
    a.click()
    toast('已导出画布 PNG')
  } catch (e) {
    toast('导出失败：' + (e?.message || e), 'error')
  } finally {
    if (hint) hint.style.display = ''
    setViewport(prev)
  }
}

watch(
  () => store.ui.exportPngTick,
  () => {
    if (store.ui.exportPngTick) exportPng()
  }
)

flowOnConnect((conn) => {
  if (conn.source && conn.target) connectNodes(conn.source, conn.target)
})

function onNodeDragStop({ node }) {
  moveNode(node.id, node.position.x, node.position.y)
}

function onNodeClick({ node }) {
  selectNode(node.id)
}

function onPaneClick() {
  store.ui.selectedNodeId = null
  store.ui.view = 'topology'
}

function onEdgeDoubleClick({ edge }) {
  removeLink(edge.id)
}

function handleDragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}

function handleDrop(e) {
  e.preventDefault()
  const tpl = e.dataTransfer?.getData('application/fasteredge-template')
  if (!tpl) return
  const pos = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
  addNodeFromTemplate(tpl, pos.x, pos.y)
}
</script>

<template>
  <div ref="canvasRef" class="canvas-wrap" @dragover.prevent="handleDragOver" @drop.prevent="handleDrop">
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="nodeTypes"
      :min-zoom="0.2"
      :max-zoom="2"
      :default-viewport="{ x: 40, y: 40, zoom: 1 }"
      @node-drag-stop="onNodeDragStop"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
      @edge-double-click="onEdgeDoubleClick"
    >
      <Background pattern-color="#1a2436" :gap="24" />
      <Controls position="bottom-left" />
      <MiniMap
        position="bottom-right"
        :node-color="(n) => store.world?.nodes.find((x) => x.id === n.id)?.color || '#3b82f6'"
        :mask-color="'rgba(11,15,23,0.75)'"
        pannable
        zoomable
      />
    </VueFlow>
    <div v-if="store.ui.view === 'inspector' && store.ui.selectedNodeId" class="canvas-hint">
      选中：{{ store.world.nodes.find((n) => n.id === store.ui.selectedNodeId)?.name }} · 在右侧面板配置 Data / Ability / 命令
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.canvas-hint {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  background: var(--bg-2);
  border: 1px solid var(--accent);
  color: var(--text);
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 11px;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.canvas-wrap:fullscreen {
  background: var(--bg);
}
</style>
