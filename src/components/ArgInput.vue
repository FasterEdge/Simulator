<script setup>

// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
import { computed } from 'vue'

const props = defineProps({
  argDef: Object,
  modelValue: { default: undefined },
})
const emit = defineEmits(['update:modelValue'])

const val = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function onInput(e) {
  val.value = e.target.value
}

function onSelect(e) {
  // select 的 e.target.value 恒为字符串；选项为数字时恢复为数字（如 QoS 0/1/2）
  const opts = props.argDef.options || []
  const v = e.target.value
  val.value = opts.some((o) => typeof o === 'number') && v !== '' ? Number(v) : v
}
</script>

<template>
  <div class="field">
    <label class="label">
      {{ argDef.label || argDef.key }}<span v-if="argDef.required" style="color: var(--danger)"> *</span>
    </label>
    <!-- 布尔 -->
    <select v-if="argDef.type === 'bool'" class="select" :value="val ? 'true' : 'false'" @change="val = $event.target.value === 'true'">
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
    <!-- 下拉 -->
    <select v-else-if="argDef.type === 'select'" class="select" :value="val" @change="onSelect">
      <option v-if="!argDef.required" value="">—</option>
      <option v-for="o in argDef.options" :key="o" :value="o">{{ o }}</option>
    </select>
    <!-- 大文本 -->
    <textarea
      v-else-if="argDef.type === 'textarea'"
      class="input"
      rows="3"
      :value="val"
      @input="onInput"
      :placeholder="argDef.placeholder"
    />
    <!-- 数字 -->
    <input
      v-else-if="argDef.type === 'number'"
      class="input"
      type="number"
      :value="val"
      @input="onInput"
      :placeholder="argDef.placeholder"
    />
    <!-- 字符串 -->
    <input
      v-else
      class="input"
      :value="val"
      @input="onInput"
      :placeholder="argDef.placeholder"
    />
  </div>
</template>
