<script setup>
import { templates, store, addComponentToNode } from '../store.js'
import { ALL } from '../core/registry/index.js'

// 拖到画布创建节点
function onDragStart(e, tpl) {
  e.dataTransfer.setData('application/fasteredge-template', tpl.name)
  e.dataTransfer.effectAllowed = 'copy'
}

// 全部可挂载组件（按类别分组）
const dataComps = Object.values(ALL).filter((c) => c.kind === 'data' && !c._hidden)
const abilityComps = Object.values(ALL).filter((c) => c.kind === 'ability' && !c._hidden)

function groupBy(list, key) {
  const m = {}
  for (const c of list) {
    ;(m[c[key]] ||= []).push(c)
  }
  return m
}
const dataGroups = groupBy(dataComps, 'category')
const abilityGroups = groupBy(abilityComps, 'category')
</script>

<template>
  <div class="left-panel">
    <div class="panel-title">⚡ 节点模板（拖到画布）</div>
    <div
      v-for="t in templates"
      :key="t.name"
      class="template-card"
      draggable="true"
      @dragstart="onDragStart($event, t)"
      @dblclick="store.ui.selectedNodeId ? null : null"
    >
      <div class="t-head">
        <span>{{ t.icon }}</span>
        <span>{{ t.label }}</span>
      </div>
      <div class="t-desc">{{ t.describe }}</div>
      <div class="t-chips">
        <span v-for="d in t.data.slice(0, 4)" :key="d" class="chip">{{ d.replace('Data', '') }}</span>
        <span v-if="t.data.length > 4" class="chip">+{{ t.data.length - 4 }}</span>
      </div>
    </div>

    <div class="panel-title">🧩 Data 组件（点击挂载到选中节点）</div>
    <div v-for="(list, cat) in dataGroups" :key="'d' + cat" class="section">
      <div class="section-title">{{ cat }}</div>
      <div class="t-chips">
        <span
          v-for="c in list"
          :key="c.name"
          class="cmp-chip data"
          style="cursor: pointer; margin: 2px"
          :title="c.describe"
          @click="addComponentToNode(c.name)"
        >{{ c.name }}</span>
      </div>
    </div>

    <div class="panel-title">🌿 Ability 组件（点击挂载到选中节点）</div>
    <div v-for="(list, cat) in abilityGroups" :key="'a' + cat" class="section">
      <div class="section-title">{{ cat }}</div>
      <div class="t-chips">
        <span
          v-for="c in list"
          :key="c.name"
          class="cmp-chip ability"
          style="cursor: pointer; margin: 2px"
          :title="c.describe"
          @click="addComponentToNode(c.name)"
        >{{ c.name }}</span>
      </div>
    </div>
  </div>
</template>