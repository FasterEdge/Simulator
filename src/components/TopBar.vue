<script setup>
import {
  store,
  resetWorld,
  loadExample,
  saveWorld,
  exportWorld,
  importWorldFile,
  loadSampleScenarios,
  requestExportPng,
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
    <div class="project-name" :title="store.world?.name || ''">{{ store.world?.name || '加载中…' }}</div>
    <div class="spacer" />
    <button class="btn sm" title="清空当前拓扑，从空白画布开始" @click="resetWorld">新建</button>
    <button class="btn sm primary" title="载入示例拓扑（云端 + 双边缘）" @click="loadExample">示例拓扑</button>
    <span class="tb-sep" />
    <button class="btn sm" title="保存到 localStorage" @click="saveWorld">保存</button>
    <button class="btn sm" title="导出为 JSON 文件" @click="exportWorld">导出 JSON</button>
    <button class="btn sm primary" title="导出当前画布为完整 PNG 图片" @click="requestExportPng">导出 PNG</button>
    <button class="btn sm" title="从 JSON 文件导入拓扑" @click="fileInput.click()">导入 JSON</button>
    <span class="tb-sep" />
    <button class="btn sm" title="载入三个内置离线测试场景" @click="loadSampleScenarios">示例测试</button>
    <input ref="fileInput" type="file" accept="application/json,.json" style="display: none" @change="onImport" />
  </header>
</template>