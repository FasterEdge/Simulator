<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { store } from '../store.js'
import { TEMPLATES } from '../core/registry/index.js'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean,
})

const node = computed(() => store.world?.nodes.find((n) => n.id === props.data?.nodeId))
const tpl = computed(() => TEMPLATES[node.value?.template] || TEMPLATES.custom)
const dataNames = computed(() => Object.keys(node.value?.data || {}))
const abilityNames = computed(() => Object.keys(node.value?.abilities || {}))

function onShellClick() {
  store.ui.selectedNodeId = node.value?.id
  store.ui.view = 'inspector'
}
</script>

<template>
  <div class="sim-node-shell" :style="{ borderColor: node?.color || tpl.color }" @click.stop="onShellClick">
    <Handle type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Right" />

    <div class="sn-head" :style="{ background: (node?.color || tpl.color) + '22' }">
      <div class="sn-ico" :style="{ background: node?.color || tpl.color, color: '#fff' }">
        {{ tpl.icon }}
      </div>
      <div class="sn-name" :title="node?.name">{{ node?.name || '未命名' }}</div>
      <div class="sn-status" :class="node?.running ? 'on' : 'off'" />
    </div>
    <div class="sn-tag">
      <span class="role">{{ node?.role || 'no-role' }}</span>
      <span v-if="!node?.running" style="color: var(--danger)">STOPPED</span>
    </div>
    <div class="sn-comps">
      <div class="row">
        <span v-for="d in dataNames.slice(0, 4)" :key="d" class="cmp-chip data">{{ d.replace('Data', '') }}</span>
        <span v-if="dataNames.length > 4" class="more">+{{ dataNames.length - 4 }}D</span>
      </div>
      <div class="row">
        <span v-for="a in abilityNames.slice(0, 4)" :key="a" class="cmp-chip ability">{{ a.replace('Ability', '') }}</span>
        <span v-if="abilityNames.length > 4" class="more">+{{ abilityNames.length - 4 }}A</span>
      </div>
    </div>
  </div>
</template>