// ─────────────────────────────────────────────────────────────
// FasterEdge 开源项目
// Github: https://github.com/FasterEdge
// Gitee:  https://gitee.com/FasterEdge
// ─────────────────────────────────────────────────────────────
import { runCommand } from './engine.js'
import { serializeWorld, hydrateWorld } from './persistence.js'

// 命令执行 trace：录制 → JSON → 回放，回放后比对「逐条命令日志」与「终态」。
// 与 testrunner.js 的场景 DSL 互补：DSL 断言单条输出，trace 断言整段执行序列可复现。
export const TRACE_VERSION = 1

// 固定时钟基准：回放时所有 Date.now()/new Date() 都落在这个时刻
export const DEFAULT_TRACE_NOW = 1700000000000

// 确定性随机：xorshift 变体（mulberry32），同种子同序列
function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 把 env 归一化成实际生效的 {now, seed}（缺省/非法值退回内置基准）
export function resolveEnv(env) {
  const now = Number.isFinite(Number(env?.now)) ? Number(env.now) : DEFAULT_TRACE_NOW
  const seed = Number.isFinite(Number(env?.seed)) ? Number(env.seed) : 1
  return { now, seed }
}

// 在确定性环境里执行 fn，返回 fn 的返回值。只替换时间与随机这两个「外部输入」，
// 命令处理器本身照常真实执行，不做任何 mock。env 用 resolveEnv 归一化后记录进 trace。
export async function withDeterminism(env, fn) {
  const { now, seed } = resolveEnv(env)
  const RealDate = globalThis.Date
  const cryptoObj = globalThis.crypto
  const hadOwnRandom = !!(cryptoObj && Object.prototype.hasOwnProperty.call(cryptoObj, 'getRandomValues'))
  const savedOwnRandom = hadOwnRandom ? cryptoObj.getRandomValues : null
  const rnd = seededRandom(seed)

  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now)
      else super(...args)
    }
    static now() {
      return now
    }
  }

  try {
    globalThis.Date = FixedDate
    if (cryptoObj) {
      cryptoObj.getRandomValues = (buf) => {
        for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rnd() * 256)
        return buf
      }
    }
    const result = await fn()
    return result
  } finally {
    globalThis.Date = RealDate
    if (cryptoObj) {
      if (hadOwnRandom) cryptoObj.getRandomValues = savedOwnRandom
      else delete cryptoObj.getRandomValues
    }
  }
}

// 规范化：对象键排序后序列化，保证「同一份状态」在不同构建顺序下得到同一字符串
export function canonicalJson(value) {
  const seen = new WeakSet()
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return '[circular]'
    seen.add(v)
    if (Array.isArray(v)) {
      const arr = v.map(walk)
      seen.delete(v)
      return arr
    }
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k])
    seen.delete(v)
    return out
  }
  return JSON.stringify(walk(value))
}

// 结构化差异：返回 [{path, expected, actual}]，用于回放失败时给出可定位的报错
export function diffValues(expected, actual, path = '', out = []) {
  const isObj = (v) => v !== null && typeof v === 'object'
  if (isObj(expected) && isObj(actual)) {
    const isArr = Array.isArray(expected) || Array.isArray(actual)
    if (isArr && (!Array.isArray(expected) || !Array.isArray(actual))) {
      out.push({ path: path || '$', expected, actual })
      return out
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const k of keys) {
      const p = Array.isArray(expected) ? `${path}[${k}]` : `${path}.${k}`
      if (!(k in expected)) out.push({ path: p, expected: '<missing>', actual: actual[k] })
      else if (!(k in actual)) out.push({ path: p, expected: expected[k], actual: '<missing>' })
      else diffValues(expected[k], actual[k], p, out)
    }
    return out
  }
  if (expected !== actual) out.push({ path: path || '$', expected, actual })
  return out
}

function resolveNode(world, ref) {
  if (!ref) return null
  return world.nodes.find((n) => n.id === ref || n.name === ref) || null
}

// 归一化一条命令日志，用于跨世界比对（去掉时间戳，节点用名称标识）
function normalizeLogEntry(entry) {
  if (!entry) return null
  return {
    nodeName: entry.nodeName,
    component: entry.component,
    act: entry.act,
    args: entry.args ?? {},
    value: entry.value ?? null,
    err: entry.err ?? null,
  }
}

function normalizeOutput(out) {
  if (!out) return null
  return { Name: out.Name ?? null, Value: out.Value ?? null, Err: out.Err ?? null }
}

// 终态快照：序列化结果里时间戳字段已由固定时钟钉死，可逐字节比对
function snapshotState(world) {
  const ser = serializeWorld(world)
  return {
    nodes: ser.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      template: n.template,
      role: n.role,
      x: n.x,
      y: n.y,
      running: n.running,
      data: n.data,
      abilities: n.abilities,
    })),
    links: ser.links,
    scenarios: ser.scenarios,
    logs: ser.logs.map((l) => normalizeLogEntry(l)),
  }
}

// 把场景步骤转成 trace 命令序列（node 用名称，跨世界稳定）
export function commandsFromScenario(scenario) {
  return (scenario?.steps || []).map((st) => ({
    node: st.node,
    component: st.component,
    act: st.command,
    args: typeof st.args === 'string' ? safeParseArgs(st.args) : st.args || {},
  }))
}

function safeParseArgs(raw) {
  try {
    return raw.trim() ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

// 录制：在 world 上依次执行 commands，把每条命令的输出与日志、以及终态写进 trace
export async function recordTrace(world, commands, opts = {}) {
  const env = { now: opts.now ?? DEFAULT_TRACE_NOW, seed: opts.seed ?? 1 }
  const trace = {
    version: TRACE_VERSION,
    name: opts.name || 'trace',
    determinism: resolveEnv(env),
    initialWorld: null,
    steps: [],
    finalState: null,
  }
  await withDeterminism(env, async () => {
    // 初始世界在确定性环境下序列化，节点 id、密钥、clientId 等随机字段都被钉死
    trace.initialWorld = serializeWorld(world)
    for (const cmd of commands) {
      const node = resolveNode(world, cmd.node)
      if (!node) {
        trace.steps.push({
          node: cmd.node,
          component: cmd.component,
          act: cmd.act,
          args: cmd.args || {},
          out: null,
          log: null,
          error: `节点 "${cmd.node}" 不存在`,
        })
        continue
      }
      const before = world.logs.length
      const out = await runCommand(world, node.id, cmd.component, cmd.act, cmd.args || {})
      const appended = world.logs.length > before ? world.logs[world.logs.length - 1] : null
      trace.steps.push({
        node: node.name,
        component: cmd.component,
        act: cmd.act,
        args: cmd.args || {},
        out: normalizeOutput(out),
        log: normalizeLogEntry(appended),
      })
    }
    trace.finalState = snapshotState(world)
  })
  return trace
}

// 回放：从 trace 的初始世界重建，按同样顺序执行，逐条比对输出/日志，最后比对终态
export async function replayTrace(trace, opts = {}) {
  if (!trace || trace.version !== TRACE_VERSION) {
    return {
      pass: false,
      reason: `不支持的 trace 版本: ${trace?.version}`,
      steps: [],
      diffs: [{ path: 'version', expected: TRACE_VERSION, actual: trace?.version }],
      world: null,
    }
  }
  const world = hydrateWorld(JSON.parse(JSON.stringify(trace.initialWorld || {})))
  const stepResults = []
  const diffs = []
  await withDeterminism(trace.determinism || {}, async () => {
    for (const [i, step] of (trace.steps || []).entries()) {
      const node = resolveNode(world, step.node)
      const stepDiffs = []
      if (!node) {
        // 录制时该节点就不存在：回放同样应「找不到节点」，此时视为一致
        if (!step.error) stepDiffs.push({ path: 'node', expected: step.node, actual: '<missing>' })
        stepResults.push({ index: i, node: step.node, component: step.component, act: step.act, pass: stepDiffs.length === 0, diffs: stepDiffs })
        diffs.push(...stepDiffs.map((d) => ({ ...d, step: i })))
        continue
      }
      if (step.error) {
        // 录制时缺节点，回放却找到了：状态不一致
        stepDiffs.push({ path: 'node', expected: `<missing: ${step.error}>`, actual: step.node })
        stepResults.push({ index: i, node: step.node, component: step.component, act: step.act, pass: false, diffs: stepDiffs })
        diffs.push(...stepDiffs.map((d) => ({ ...d, step: i })))
        continue
      }
      const before = world.logs.length
      const out = await runCommand(world, node.id, step.component, step.act, step.args || {})
      const appended = world.logs.length > before ? world.logs[world.logs.length - 1] : null
      const outDiffs = diffValues(step.out, normalizeOutput(out), 'out')
      const logDiffs = diffValues(step.log, normalizeLogEntry(appended), 'log')
      stepDiffs.push(...outDiffs, ...logDiffs)
      stepResults.push({ index: i, node: step.node, component: step.component, act: step.act, pass: stepDiffs.length === 0, diffs: stepDiffs })
      diffs.push(...stepDiffs.map((d) => ({ ...d, step: i })))
    }
  })
  const finalDiffs = diffValues(trace.finalState, snapshotState(world), 'state')
  diffs.push(...finalDiffs)
  const failedSteps = stepResults.filter((r) => !r.pass).length
  return {
    pass: diffs.length === 0,
    traceName: trace.name,
    total: stepResults.length,
    failedSteps,
    statePass: finalDiffs.length === 0,
    steps: stepResults,
    diffs,
    env: resolveEnv(trace.determinism),
    world,
  }
}

export function traceToJSON(trace) {
  return JSON.stringify(trace, null, 2)
}

export function traceFromJSON(text) {
  return JSON.parse(text)
}

// 给调用方的一句人类可读结论（测试与 UI 共用）
export function describeReplay(result) {
  if (result.pass) return `trace「${result.traceName}」回放一致：${result.total} 条命令 + 终态`
  const head = result.diffs
    .slice(0, 3)
    .map((d) => `${d.step === undefined ? '' : `step#${d.step} `}${d.path}: 期望 ${JSON.stringify(d.expected)} 实际 ${JSON.stringify(d.actual)}`)
    .join('; ')
  return `trace「${result.traceName}」回放不一致：${result.failedSteps}/${result.total} 条命令失败，差异 ${result.diffs.length} 处（${head}）`
}
