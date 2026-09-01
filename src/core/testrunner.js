import { runCommand } from './engine.js'

// 离线测试场景：steps 按顺序执行，基于 CommandOutput 断言
// step = {
//   id, name,
//   node: 节点 id 或名称,
//   component, command, args: object,
//   expect: { success: 'any'|true|false, valueContains, errContains, valueEquals }
// }

export function newScenario(name = '新场景') {
  return {
    id: 'sc-' + Math.random().toString(36).slice(2, 8),
    name,
    steps: [],
  }
}

export function newStep() {
  return {
    id: 'st-' + Math.random().toString(36).slice(2, 8),
    name: '',
    node: '',
    component: '',
    command: '',
    args: {},
    expect: { success: 'any', valueContains: '', errContains: '', valueEquals: '' },
  }
}

function resolveNode(world, ref) {
  if (!ref) return null
  return world.nodes.find((n) => n.id === ref || n.name === ref) || null
}

// 断言一个 CommandOutput；返回 { pass, detail }
export function assertOutput(out, expect) {
  const e = expect || {}
  const reasons = []
  // success 断言
  if (e.success === true && out.Err) reasons.push(`期望成功，实际出错: ${out.Err}`)
  if (e.success === false && !out.Err) reasons.push('期望失败，实际成功')
  // valueContains
  if (e.valueContains) {
    const s = JSON.stringify(out.Value ?? '')
    if (!s.includes(e.valueContains)) reasons.push(`期望 Value 包含 "${e.valueContains}"`)
  }
  // valueEquals（兼容数字型字符串：用户写 "8080" 或 8080 都应匹配）
  if (e.valueEquals !== undefined && e.valueEquals !== '') {
    const s = JSON.stringify(out.Value ?? '')
    const parsed = tryParse(e.valueEquals, null)
    const want = JSON.stringify(parsed ?? e.valueEquals)
    // 直接字符串值（如 "8080"）或 JSON 解析后的值（如 8080）任一相等即可
    const raw = JSON.stringify(e.valueEquals)
    if (s !== want && s !== raw) reasons.push(`期望 Value 等于 ${e.valueEquals}`)
  }
  // errContains
  if (e.errContains) {
    const s = String(out.Err || '')
    if (!s.includes(e.errContains)) reasons.push(`期望 Err 包含 "${e.errContains}"`)
  }
  return { pass: reasons.length === 0, reasons }
}

function tryParse(s, fallback) {
  try {
    return JSON.parse(s)
  } catch (e) {
    return fallback
  }
}

export async function runStep(world, step) {
  const node = resolveNode(world, step.node)
  if (!node) {
    return {
      step,
      pass: false,
      reason: `节点 "${step.node}" 不存在`,
      output: null,
      skip: true,
    }
  }
  // args 可能是编辑器里的 JSON 字符串，解析成对象
  let args = step.args || {}
  if (typeof args === 'string') {
    try {
      args = args.trim() ? JSON.parse(args) : {}
    } catch (e) {
      return {
        step,
        pass: false,
        reason: `参数不是合法 JSON: ${e.message}`,
        output: null,
        skip: true,
      }
    }
  }
  const out = await runCommand(world, node.id, step.component, step.command, args)
  const { pass, reasons } = assertOutput(out, step.expect)
  return { step, pass, reason: reasons.join('; '), output: out }
}

export async function runScenario(world, scenario, onProgress = () => {}) {
  const results = []
  let passed = 0
  for (const step of scenario.steps) {
    const r = await runStep(world, step)
    results.push(r)
    if (r.pass && !r.skip) passed++
    onProgress && onProgress(r, results)
  }
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    total: scenario.steps.length,
    passed,
    failed: results.filter((r) => !r.pass && !r.skip).length,
    skipped: results.filter((r) => r.skip).length,
    results,
  }
}

// 一些内置示例步骤（供一键填充）
export const sampleScenarios = () => [
  {
    id: 'sc-sample-mqtt',
    name: '示例：MQTT 跨节点订阅/发布',
    steps: [
      { id: 'st1', name: 'edge-01 连接 Broker', node: 'edge-01', component: 'MQTTAbility', command: 'connect', args: {}, expect: { success: true, valueContains: 'connected' } },
      { id: 'st2', name: 'edge-02 连接 Broker', node: 'edge-02', component: 'MQTTAbility', command: 'connect', args: {}, expect: { success: true } },
      { id: 'st3', name: 'edge-02 订阅状态主题', node: 'edge-02', component: 'MQTTAbility', command: 'subscribe', args: { Topic: 'edge/+/status', Qos: 0 }, expect: { success: true } },
      { id: 'st4', name: 'edge-01 发布在线状态', node: 'edge-01', component: 'MQTTAbility', command: 'publish', args: { Topic: 'edge/01/status', Payload: 'online', Qos: 0 }, expect: { success: true, valueContains: 'delivered' } },
      { id: 'st5', name: 'edge-02 排空订阅队列', node: 'edge-02', component: 'MQTTAbility', command: 'drain', args: {}, expect: { success: true, valueContains: 'online' } },
    ],
  },
  {
    id: 'sc-sample-onekey',
    name: '示例：OneKey 令牌签发与校验',
    steps: [
      { id: 'st1', name: 'cloud-ctl 签发令牌', node: 'cloud-ctl', component: 'OneKeyAbility', command: 'issue_token', args: { Subject: 'edge-01', TTL: 3600 }, expect: { success: true, valueContains: 'Signature' } },
      { id: 'st2', name: 'cloud-ctl 校验非法令牌', node: 'cloud-ctl', component: 'OneKeyAbility', command: 'verify_token', args: { Subject: 'edge-01', IssuedAt: 0, ExpiresAt: 0, Signature: 'bad' }, expect: { success: false, errContains: 'invalid' } },
      { id: 'st3', name: 'cloud-ctl 密钥状态', node: 'cloud-ctl', component: 'OneKeyAbility', command: 'status', args: {}, expect: { success: true } },
    ],
  },
  {
    id: 'sc-sample-config',
    name: '示例：ConfigData 读写与 ConfigFile 持久化',
    steps: [
      { id: 'st1', name: 'edge-01 写配置', node: 'edge-01', component: 'ConfigData', command: 'set', args: { Key: 'server.port', Value: '8080' }, expect: { success: true } },
      { id: 'st2', name: 'edge-01 读配置', node: 'edge-01', component: 'ConfigData', command: 'get', args: { Key: 'server.port' }, expect: { success: true, valueEquals: '8080' } },
      { id: 'st3', name: 'edge-01 保存到文件', node: 'edge-01', component: 'ConfigFileAbility', command: 'save', args: {}, expect: { success: true } },
      { id: 'st4', name: 'edge-01 清空并重新加载', node: 'edge-01', component: 'ConfigData', command: 'delete', args: { Key: 'server.port' }, expect: { success: true } },
      { id: 'st5', name: 'edge-01 从文件加载', node: 'edge-01', component: 'ConfigFileAbility', command: 'load', args: {}, expect: { success: true } },
      { id: 'st6', name: 'edge-01 读回配置', node: 'edge-01', component: 'ConfigData', command: 'get', args: { Key: 'server.port' }, expect: { success: true, valueEquals: '8080' } },
    ],
  },
]