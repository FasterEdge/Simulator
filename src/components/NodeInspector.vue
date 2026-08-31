<script setup>
import { computed, ref } from 'vue'
import {
  store,
  selectedNode,
  updateNodeName,
  updateNodeRole,
  toggleNodeRunning,
  deleteSelectedNode,
  addComponentToNode,
  removeComponentFromNode,
  selectComponent,
} from '../store.js'
import { ALL } from '../core/registry/index.js'
import ComponentPanel from './ComponentPanel.vue'

const node = computed(() => selectedNode())

// 未挂载的可选组件
const available = computed(() => {
  if (!node.value) return []
  const have = new Set([...Object.keys(node.value.data), ...Object.keys(node.value.abilities)])
  return Object.values(ALL)
    .filter((c) => !have.has(c.name))
    .map((c) => ({ name: c.name, kind: c.kind, category: c.category }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'data' ? -1 : 1))
})

const addSel = ref('')
function onAdd() {
  if (addSel.value) {
    addComponentToNode(addSel.value)
    addSel.value = ''
  }
}
</script>

<template>
  <div>
    <template v-if="node">
      <!-- 节点元信息 -->
      <div class="section">
        <div class="section-title">
          节点
          <button class="btn sm danger" @click="deleteSelectedNode">删除</button>
        </div>
        <div class="field">
          <label class="label">名称</label>
          <input class="input" :value="node.name" @input="updateNodeName($event.target.value)" />
        </div>
        <div class="field" style="display: flex; gap: 8px">
          <div style="flex: 1">
            <label class="label">角色</label>
            <select class="select" :value="node.role" @change="updateNodeRole($event.target.value)">
              <option value="">—</option>
              <option value="cloud">cloud</option>
              <option value="edge">edge</option>
              <option value="db">db</option>
              <option value="sensor">sensor</option>
            </select>
          </div>
          <div style="flex: 1">
            <label class="label">状态</label>
            <button class="btn" :class="node.running ? '' : 'danger'" style="width: 100%" @click="toggleNodeRunning">
              {{ node.running ? '🟢 运行中' : '⛔ 已停止' }}
            </button>
          </div>
        </div>
        <div class="field">
          <label class="label">模板</label>
          <div class="node-ref">{{ node.template }}</div>
        </div>
      </div>

      <!-- 挂载组件 -->
      <div class="section">
        <div class="section-title">挂载组件（{{ Object.keys(node.data).length + Object.keys(node.abilities).length }}）</div>

        <div style="display: flex; gap: 6px; margin-bottom: 8px">
          <select class="select" v-model="addSel">
            <option value="">选择组件挂载…</option>
            <optgroup v-for="kind in ['data', 'ability']" :key="kind" :label="kind === 'data' ? '🌿 Data' : '🌱 Ability'">
              <option v-for="c in available.filter((x) => x.kind === kind)" :key="c.name" :value="c.name">
                {{ c.name }}（{{ c.category }}）
              </option>
            </optgroup>
          </select>
          <button class="btn sm primary" @click="onAdd">挂载</button>
        </div>

        <!-- Data 组件 -->
        <div class="section-title" style="font-size: 11px; color: var(--accent-2)">Data（根）</div>
        <div v-for="name in Object.keys(node.data)" :key="'d' + name" class="comp-card">
          <div class="head" @click="selectComponent(name)">
            <span class="kind cmp-chip data">D</span>
            <span class="name">{{ name }}</span>
            <span
              class="btn sm"
              style="color: var(--danger)"
              @click.stop="removeComponentFromNode(name)"
            >卸载</span>
          </div>
          <div v-if="store.ui.selectedComponent === name" class="body">
            <ComponentPanel :node-id="node.id" :component="name" kind="data" />
          </div>
        </div>

        <!-- Ability 组件 -->
        <div class="section-title" style="font-size: 11px; color: var(--accent)">Ability（枝干）</div>
        <div v-for="name in Object.keys(node.abilities)" :key="'a' + name" class="comp-card">
          <div class="head" @click="selectComponent(name)">
            <span class="kind cmp-chip ability">A</span>
            <span class="name">{{ name }}</span>
            <span
              class="btn sm"
              style="color: var(--danger)"
              @click.stop="removeComponentFromNode(name)"
            >卸载</span>
          </div>
          <div v-if="store.ui.selectedComponent === name" class="body">
            <ComponentPanel :node-id="node.id" :component="name" kind="ability" />
          </div>
        </div>
      </div>
    </template>
    <div v-else class="empty">
      从左侧拖入节点模板到画布<br />点击节点即可在此配置其 Data / Ability 并执行命令
    </div>
  </div>
</template>