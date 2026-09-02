<script setup>

// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { store, initApp, saveWorld, toggleLeft, toggleRight } from './store.js'
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

// 自动保存（防抖，静默——不每次弹提示）
let saveTimer = null
watch(
  () => store.world,
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWorld({ silent: true }), 1200)
  },
  { deep: true }
)
onBeforeUnmount(() => clearTimeout(saveTimer))
</script>

<template>
  <div class="app">
    <TopBar />
    <div class="main-row">
      <button
        class="sidebar-toggle left"
        :class="{ active: store.ui.leftOpen }"
        :title="store.ui.leftOpen ? '收起左侧面板' : '展开左侧面板'"
        @click="toggleLeft"
      >{{ store.ui.leftOpen ? '◀' : '▶' }}</button>

      <div class="left-side" :class="{ collapsed: !store.ui.leftOpen }">
        <Palette />
      </div>

      <TopologyCanvas />

      <div class="right-side" :class="{ collapsed: !store.ui.rightOpen, wide: store.ui.inspectorTab === 'console' }">
        <aside class="right-panel">
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

      <button
        class="sidebar-toggle right"
        :class="{ active: store.ui.rightOpen }"
        :title="store.ui.rightOpen ? '收起右侧面板' : '展开右侧面板'"
        @click="toggleRight"
      >{{ store.ui.rightOpen ? '▶' : '◀' }}</button>
    </div>
    <div class="toasts">
      <div v-for="t in store.toasts" :key="t.id" class="toast" :class="{ error: t.type === 'error' }">
        {{ t.msg }}
      </div>
    </div>
  </div>
</template>
