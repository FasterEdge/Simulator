<script setup>
import { computed, ref } from 'vue'
import { store } from '../store.js'

const filter = ref('')
const showErrOnly = ref(false)

const logs = computed(() => {
  let list = store.world?.logs || []
  if (showErrOnly.value) list = list.filter((l) => l.err)
  if (filter.value.trim()) {
    const f = filter.value.trim().toLowerCase()
    list = list.filter(
      (l) =>
        (l.nodeName || '').toLowerCase().includes(f) ||
        (l.component || '').toLowerCase().includes(f) ||
        (l.act || '').toLowerCase().includes(f)
    )
  }
  return [...list].reverse().slice(0, 500)
})

function timeStr(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function clearLogs() {
  if (store.world) store.world.logs = []
}
</script>

<template>
  <div>
    <div class="section">
      <div class="section-title">
        命令执行日志（{{ store.world?.logs?.length || 0 }}）
        <button class="btn sm" @click="clearLogs">清空</button>
      </div>
      <div style="display: flex; gap: 6px; margin-bottom: 8px">
        <input class="input" v-model="filter" placeholder="过滤：节点 / 组件 / 命令" />
        <label class="label" style="display: flex; align-items: center; gap: 4px; margin: 0; white-space: nowrap">
          <input type="checkbox" v-model="showErrOnly" /> 仅错误
        </label>
      </div>
    </div>
    <div v-if="logs.length === 0" class="empty">还没有命令日志。选中节点 → 挂载组件 → 执行命令。</div>
    <div
      v-for="(l, i) in logs"
      :key="l.ts + '-' + i"
      class="log-line"
      :class="{ 'has-err': l.err }"
      :title="JSON.stringify(l, null, 2)"
    >
      <span class="t">{{ timeStr(l.ts) }}</span>
      <span class="who">{{ l.nodeName }}</span>
      <span class="act">{{ l.component }}.{{ l.act }}</span>
      <span v-if="l.err" class="res-err">✗ {{ l.err }}</span>
      <span v-else class="res-ok">✓</span>
      <span v-if="!l.err && l.value !== null && l.value !== undefined" class="val">{{ JSON.stringify(l.value).slice(0, 120) }}</span>
    </div>
  </div>
</template>