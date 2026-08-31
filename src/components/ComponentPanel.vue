<script setup>
import { computed, ref } from 'vue'
import { store, execCommand } from '../store.js'
import { ALL } from '../core/registry/index.js'
import ArgInput from './ArgInput.vue'

const props = defineProps({
  nodeId: String,
  component: String,
  kind: String,
})

const def = computed(() => ALL[props.component])
const state = computed(() => {
  const node = store.world.nodes.find((n) => n.id === props.nodeId)
  if (!node) return null
  return props.kind === 'data' ? node.data[props.component] : node.abilities[props.component]
})

const commands = computed(() => {
  const cmds = Object.entries(def.value?.commands || {}).map(([name, c]) => ({
    name,
    describe: c.describe || '',
    args: c.args || [],
  }))
  return cmds.sort((a, b) => a.name.localeCompare(b.name))
})

const activeCmd = ref(null)
const argValues = ref({})
const result = ref(null) // {out, ok, running}
const error = ref(null)

function openCmd(cmd) {
  activeCmd.value = activeCmd.value?.name === cmd.name ? null : cmd
  argValues.value = {}
  result.value = null
  error.value = null
}

async function run() {
  if (!activeCmd.value) return
  const cmd = activeCmd.value
  const args = {}
  let valid = true
  for (const a of cmd.args) {
    let v = argValues.value[a.key]
    if (v === undefined || v === null) v = a.default
    if ((v === undefined || v === '') && a.required) {
      error.value = `缺少必填参数 ${a.label || a.key}`
      valid = false
      break
    }
    if (a.type === 'number' && v !== undefined && v !== '') v = Number(v)
    if (a.type === 'bool') v = !!v
    args[a.key] = v
  }
  if (!valid) return
  result.value = null
  error.value = null
  try {
    const out = await execCommand(props.nodeId, props.component, cmd.name, args)
    result.value = { out, ok: !out.Err }
  } catch (e) {
    result.value = { out: { Name: cmd.name, Value: null, Err: String(e?.message || e) }, ok: false }
  }
}

function stateJson() {
  try {
    return JSON.stringify(state.value, null, 2)
  } catch (e) {
    return String(state.value)
  }
}
</script>

<template>
  <div>
    <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 8px; line-height: 1.5">
      {{ def?.describe }}
      <span v-if="def?.deps?.length" style="display: block; margin-top: 3px">
        依赖: <span v-for="d in def.deps" :key="d" class="node-ref" style="margin-right: 4px">{{ d }}</span>
      </span>
    </div>

    <!-- 状态预览 -->
    <details class="state-box" open>
      <summary>📦 组件状态</summary>
      <pre>{{ stateJson() }}</pre>
    </details>

    <!-- 命令列表 -->
    <div class="section-title" style="margin-bottom: 6px">
      ⚡ 命令
      <span class="count">{{ commands.length }}</span>
    </div>
    <div v-for="cmd in commands" :key="cmd.name" class="cmd-item" :class="{ open: activeCmd && activeCmd.name === cmd.name }">
      <div class="cmd-head" @click="openCmd(cmd)">
        <span class="cmd-name">{{ cmd.name }}</span>
        <span class="cmd-desc" :title="cmd.describe">{{ cmd.describe }}</span>
        <span class="cmd-chev">▶</span>
      </div>
      <div v-if="activeCmd && activeCmd.name === cmd.name" class="cmd-body">
        <ArgInput v-for="a in cmd.args" :key="a.key" :arg-def="a" v-model="argValues[a.key]" />
        <div style="display: flex; gap: 8px; align-items: center">
          <button class="btn sm primary" @click="run">▶ 执行</button>
          <span v-if="error" style="color: var(--danger); font-size: 11px">{{ error }}</span>
        </div>
        <div v-if="result" class="cmd-output" :class="result.ok ? 'ok' : 'err'">
          <template v-if="result.out.Err"><b>Err:</b> {{ result.out.Err }}</template>
          <template v-else>{{ JSON.stringify(result.out.Value, null, 2) }}</template>
        </div>
      </div>
    </div>
  </div>
</template>