<script setup>
import {
  store,
  resetWorld,
  loadExample,
  saveWorld,
  exportWorld,
  importWorldFile,
  loadSampleScenarios,
} from '../store.js'
import { ref } from 'vue'

const fileInput = ref(null)

function onImport(e) {
  const file = e.target.files?.[0]
  if (file) importWorldFile(file)
  e.target.value = ''
}
</script>

<template>
  <header class="topbar">
    <div class="logo">
      🌳 FasterEdge <span class="tag">离线模拟编排</span>
    </div>
    <div class="project-name">{{ store.world?.name || '加载中…' }}</div>
    <div class="spacer" />
    <button class="btn sm" @click="resetWorld">新建</button>
    <button class="btn sm" @click="loadExample">示例拓扑</button>
    <button class="btn sm" @click="saveWorld">保存</button>
    <button class="btn sm" @click="exportWorld">导出 JSON</button>
    <button class="btn sm" @click="fileInput.click()">导入 JSON</button>
    <button class="btn sm" @click="loadSampleScenarios">示例测试</button>
    <input ref="fileInput" type="file" accept="application/json,.json" style="display: none" @change="onImport" />
  </header>
</template>