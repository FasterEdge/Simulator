// ─────────────────────────────────────────────────────────────
// FasterEdge 开源项目
// Github: https://github.com/FasterEdge
// Gitee:  https://gitee.com/FasterEdge
// ─────────────────────────────────────────────────────────────
// 命令 trace 录制 / 回放 CLI（离线，无 DOM 依赖）
//
//   录制：node scripts/trace.mjs record --scenario 0 --out ../artifacts/mqtt.trace.json
//   回放：node scripts/trace.mjs replay ../artifacts/mqtt.trace.json
//   直接跑一遍（录制后立刻回放）：node scripts/trace.mjs selftest
//
// 退出码：0 通过，1 回放不一致 / 参数错误。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildExampleWorld } from '../src/core/persistence.js'
import { sampleScenarios } from '../src/core/testrunner.js'
import {
  recordTrace,
  replayTrace,
  traceToJSON,
  traceFromJSON,
  commandsFromScenario,
  describeReplay,
} from '../src/core/trace.js'

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next
        i++
      } else out[key] = true
    } else out._.push(a)
  }
  return out
}

async function record(args) {
  const scenarioIndex = Number(args.scenario ?? 0)
  const scenarios = sampleScenarios()
  const scenario = scenarios[scenarioIndex]
  if (!scenario) {
    console.error(`没有索引为 ${scenarioIndex} 的示例场景（共 ${scenarios.length} 个）`)
    process.exit(1)
  }
  const world = buildExampleWorld()
  const trace = await recordTrace(world, commandsFromScenario(scenario), {
    name: args.name || scenario.name,
    now: args.now !== undefined ? Number(args.now) : undefined,
    seed: args.seed !== undefined ? Number(args.seed) : undefined,
  })
  const target = args.out ? resolve(String(args.out)) : null
  if (target) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, traceToJSON(trace) + '\n', 'utf8')
    console.log(`已录制 ${trace.steps.length} 条命令 → ${target}`)
  } else {
    process.stdout.write(traceToJSON(trace) + '\n')
  }
  return trace
}

async function replay(file) {
  if (!file) {
    console.error('用法：node scripts/trace.mjs replay <trace.json>')
    process.exit(1)
  }
  const trace = traceFromJSON(readFileSync(resolve(String(file)), 'utf8'))
  const result = await replayTrace(trace)
  console.log(describeReplay(result))
  if (!result.pass) {
    for (const d of result.diffs.slice(0, 10)) {
      console.log(`  ${d.step === undefined ? '[终态]' : `[step#${d.step}]`} ${d.path}: 期望 ${JSON.stringify(d.expected)} 实际 ${JSON.stringify(d.actual)}`)
    }
  }
  process.exit(result.pass ? 0 : 1)
}

const args = parseArgs(process.argv.slice(2))
const mode = args._[0]

if (mode === 'record') {
  await record(args)
} else if (mode === 'replay') {
  await replay(args._[1])
} else if (mode === 'selftest') {
  // 录制 → 序列化 JSON → 反序列化 → 回放，端到端走一遍完整链路
  const trace = await record({ ...args, out: args.out || undefined })
  const roundTripped = traceFromJSON(traceToJSON(trace))
  const result = await replayTrace(roundTripped)
  console.log(describeReplay(result))
  process.exit(result.pass ? 0 : 1)
} else {
  console.error('用法：node scripts/trace.mjs <record|replay|selftest> [选项]')
  process.exit(1)
}
