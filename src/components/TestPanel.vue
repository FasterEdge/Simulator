<script setup>
import { ref, computed } from 'vue'
import { store, runScenarioOnWorld, addScenario, removeScenario, loadSampleScenarios } from '../store.js'
import { ALL } from '../core/registry/index.js'
import { newStep } from '../core/testrunner.js'

const running = ref(false)
const runResults = ref(null)

async function run(sc) {
  if (!sc.steps.length) return
  running.value = true
  runResults.value = null
  try {
    const res = await runScenarioOnWorld(sc)
    runResults.value = res
  } finally {
    running.value = false
  }
}

function addStep(sc) {
  const st = newStep()
  st.node = store.world.nodes[0]?.name || ''
  sc.steps.push(st)
  save()
}

function removeStep(sc, i) {
  sc.steps.splice(i, 1)
  save()
}

function save() {
  // 触发自动保存即可
}

const nodeOptions = computed(() => (store.world?.nodes || []).map((n) => n.name))
const compOptions = computed(() => Object.keys(ALL))

function commandsFor(comp) {
  const def = ALL[comp]
  return def ? Object.keys(def.commands || {}) : []
}
</script>

<template>
  <div>
    <div class="section">
      <div class="section-title">
        离线编排测试
        <div style="display: flex; gap: 6px">
          <button class="btn sm" @click="addScenario">新建场景</button>
          <button class="btn sm" @click="loadSampleScenarios">示例场景</button>
        </div>
      </div>
      <div class="empty" style="padding: 8px">
        编写命令步骤 → 运行 → 按断言判定 PASS / FAIL。全程离线模拟，无后端。
      </div>
    </div>

    <div v-for="sc in store.world?.scenarios || []" :key="sc.id" class="scenario-card">
      <div class="head">
        <input
          class="input"
          :value="sc.name"
          style="flex: 1"
          @input="sc.name = $event.target.value"
        />
        <button class="btn sm primary" :disabled="running" @click="run(sc)">▶ 运行</button>
        <button class="btn sm danger" @click="removeScenario(sc.id)">删</button>
      </div>

      <div class="steps">
        <div v-if="!sc.steps.length" class="empty" style="padding: 6px">暂无步骤</div>
        <div v-for="(st, i) in sc.steps" :key="st.id" class="step-row">
          <span class="idx">{{ i + 1 }}</span>
          <div class="body">
            <input
              class="input"
              :value="st.name"
              placeholder="步骤说明"
              style="margin-bottom: 4px"
              @input="st.name = $event.target.value"
            />
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-bottom: 4px">
              <select class="select" :value="st.node" @change="st.node = $event.target.value">
                <option value="">节点…</option>
                <option v-for="n in nodeOptions" :key="n" :value="n">{{ n }}</option>
              </select>
              <select class="select" :value="st.component" @change="st.component = $event.target.value">
                <option value="">组件…</option>
                <option v-for="c in compOptions" :key="c" :value="c">{{ c }}</option>
              </select>
              <select
                class="select"
                :value="st.command"
                :disabled="!st.component"
                @change="st.command = $event.target.value"
              >
                <option value="">命令…</option>
                <option v-for="c in commandsFor(st.component)" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <textarea
              class="input"
              :value="typeof st.args === 'string' ? st.args : JSON.stringify(st.args || {})"
              placeholder='参数 JSON，例如 {"Topic":"edge/+/status"}'
              style="min-height: 34px; margin-bottom: 4px"
              @input="st.args = $event.target.value"
            />
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
              <label class="label" style="margin: 0; display: flex; gap: 4px; align-items: center">
                期望
                <select class="select" v-model="st.expect.success" style="width: auto">
                  <option value="any">任意</option>
                  <option :value="true">成功</option>
                  <option :value="false">失败</option>
                </select>
              </label>
              <input
                class="input"
                :value="st.expect.valueContains"
                placeholder="Value 包含"
                style="width: 130px"
                @input="st.expect.valueContains = $event.target.value"
              />
              <input
                class="input"
                :value="st.expect.errContains"
                placeholder="Err 包含"
                style="width: 130px"
                @input="st.expect.errContains = $event.target.value"
              />
              <button class="btn sm" style="color: var(--danger)" @click="removeStep(sc, i)">✕</button>
            </div>
          </div>
        </div>
        <button class="btn sm" style="margin-top: 6px" @click="addStep(sc)">+ 添加步骤</button>
      </div>
    </div>

    <!-- 运行结果 -->
    <div v-if="runResults" class="section">
      <div class="section-title">
        结果：{{ runResults.scenarioName }}
        <span class="badge pass">{{ runResults.passed }} 通过</span>
        <span class="badge fail">{{ runResults.failed }} 失败</span>
        <span class="badge skip">{{ runResults.skipped }} 跳过</span>
      </div>
      <div v-for="(r, i) in runResults.results" :key="i" class="step-row" :class="r.pass ? 'pass' : 'fail'">
        <span class="idx">{{ i + 1 }}</span>
        <div class="body">
          <div style="display: flex; gap: 6px; align-items: center">
            <span class="badge" :class="r.pass ? 'pass' : r.skip ? 'skip' : 'fail'">
              {{ r.pass ? 'PASS' : r.skip ? 'SKIP' : 'FAIL' }}
            </span>
            <b>{{ r.step.name || r.step.component + '.' + r.step.command }}</b>
          </div>
          <div v-if="r.reason" style="color: var(--danger); font-size: 11px; margin-top: 2px">{{ r.reason }}</div>
          <pre
            v-if="r.output"
            style="margin-top: 4px; font-size: 10.5px; color: var(--text-dim); font-family: var(--mono); max-height: 90px; overflow: auto; white-space: pre-wrap; word-break: break-all"
          >{{ r.output.Err ? 'Err: ' + r.output.Err : JSON.stringify(r.output.Value, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>