<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { store, initApp, saveWorld } from './store.js'
import TopBar from './components/TopBar.vue'
import Palette from './components/Palette.vue'
import TopologyCanvas from './components/TopologyCanvas.vue'
import NodeInspector from './components/NodeInspector.vue'
import ConsolePanel from './components/ConsolePanel.vue'
import TestPanel from './components/TestPanel.vue'

onMounted(() => {
  initApp()
  store.ui.view = store.ui.selectedNodeId ? 'inspector' : 'topology'
})

// 自动保存（防抖）
let saveTimer = null
watch(
  () => store.world,
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWorld(), 1200)
  },
  { deep: true }
)
onBeforeUnmount(() => clearTimeout(saveTimer))
</script>

<template>
  <div class="app">
    <TopBar />
    <div class="main-row">
      <Palette />
      <TopologyCanvas />
      <aside class="right-panel" :class="{ wide: store.ui.inspectorTab === 'console' }">
        <div class="right-tabs">
          <div class="right-tab" :class="{ active: store.ui.inspectorTab === 'node' }" @click="store.ui.inspectorTab = 'node'">
            🧩 节点
          </div>
          <div class="right-tab" :class="{ active: store.ui.inspectorTab === 'console' }" @click="store.ui.inspectorTab = 'console'">
            📟 控制台
          </div>
          <div class="right-tab" :class="{ active: store.ui.inspectorTab === 'test' }" @click="store.ui.inspectorTab = 'test'">
            ✅ 测试
          </div>
        </div>
        <div class="right-body">
          <NodeInspector v-show="store.ui.inspectorTab === 'node'" />
          <ConsolePanel v-show="store.ui.inspectorTab === 'console'" />
          <TestPanel v-show="store.ui.inspectorTab === 'test'" />
        </div>
      </aside>
    </div>
    <div class="toasts">
      <div v-for="t in store.toasts" :key="t.id" class="toast" :class="{ error: t.type === 'error' }">
        {{ t.msg }}
      </div>
    </div>
  </div>
</template>