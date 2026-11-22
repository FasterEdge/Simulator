// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
//
// 契约比对器：把 FasterEdge 主仓库提取的 contract.json 与 Simulator 的
// src/core/registry/*.js 实际分派做 schema 级差分。
//
// 与"文档比对"的区别：这里读的是 registry 的真实导出对象（component.commands
// 与每个命令的 args 声明），不是 README 表格。Simulator 宣称"与主仓库命令模型
// 完全对齐"，这句话必须由数据背书。
//
// 输出四类差异（外加一类结构性差异）：
//   missingCommand  Go 有、Simulator 无（宣称对齐但实际调不通）
//   extraCommand    Simulator 有、Go 无（模拟器发明了命令）
//   argNameDiff     参数名不一致（同名命令参数对不上）
//   requiredDiff    必填判定不一致（Go 显式拒绝空值 / Simulator 未标 required）
//   shapeDiff       参数结构形状不一致（Go 嵌套 wrapper / Simulator 扁平）
//
// 退出码：--strict 时存在 missing/extra/argNameDiff/requiredDiff 即非 0，
// 用于 CI 门禁；默认只打印报告。

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const simulatorRoot = resolve(here, '../..')

export const DIFF_KINDS = [
  'missingCommand',
  'extraCommand',
  'argNameDiff',
  'requiredDiff',
  'shapeDiff',
]

// ── 读入两侧 ────────────────────────────────────────────────

export function loadContract(path) {
  if (!existsSync(path)) {
    throw new Error(`contract.json 不存在: ${path}\n先在 FasterEdge 仓库运行: go run ./cmd/contract -out dist/contract.json`)
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export async function loadRegistry() {
  const registryUrl = pathToFileURL(join(simulatorRoot, 'src/core/registry/index.js')).href
  const mod = await import(registryUrl)
  const all = mod.ALL
  const out = []
  for (const [name, def] of Object.entries(all)) {
    const commands = {}
    for (const [act, cmd] of Object.entries(def.commands || {})) {
      commands[act] = (cmd.args || []).map((a) => ({
        key: a.key,
        required: a.required === true,
        type: a.type,
      }))
    }
    out.push({ name, kind: def.kind, commands })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// ── 差分 ────────────────────────────────────────────────────

function argMaps(contractCmd, simArgs) {
  const goArgs = new Map()
  for (const f of contractCmd.args.fields || []) {
    goArgs.set(f.json || f.name, { required: f.required, type: f.type })
  }
  const sim = new Map((simArgs || []).map((a) => [a.key, a]))
  return { goArgs, sim }
}

export function diff(contract, registry) {
  const goComps = new Map(contract.components.map((c) => [c.name, c]))
  const simComps = new Map(registry.map((c) => [c.name, c]))

  const report = {
    generatedFrom: contract.generator,
    counts: {
      goComponents: goComps.size,
      simComponents: simComps.size,
      goCommands: 0,
      simCommands: 0,
    },
    missingComponents: [],
    extraComponents: [],
    diffs: [],
  }

  for (const [name] of goComps) {
    if (!simComps.has(name)) report.missingComponents.push(name)
  }
  for (const [name] of simComps) {
    if (!goComps.has(name)) report.extraComponents.push(name)
  }

  for (const [name, goComp] of goComps) {
    const simComp = simComps.get(name)
    if (!simComp) continue
    for (const goCmd of goComp.commands) report.counts.goCommands++
    const simActs = new Set(Object.keys(simComp.commands))
    const goActs = new Set(goComp.commands.map((c) => c.name))

    for (const goCmd of goComp.commands) {
      if (!simActs.has(goCmd.name)) {
        report.diffs.push({
          kind: 'missingCommand',
          component: name,
          command: goCmd.name,
          detail: `Go 常量 ${goCmd.constant}`,
        })
        continue
      }
      const simArgs = simComp.commands[goCmd.name] || []
      report.counts.simCommands++
      const { goArgs, sim } = argMaps(goCmd, simArgs)

      // Go 侧 wrapper（configure 类）：Simulator 用扁平参数，是结构性差异
      if (goCmd.args.wrapper) {
        report.diffs.push({
          kind: 'shapeDiff',
          component: name,
          command: goCmd.name,
          detail: `Go 嵌套 ${goCmd.args.type}{${goCmd.args.fields.map((f) => f.name).join(',')}}，Simulator 扁平参数`,
          goFields: goCmd.args.fields.map((f) => f.json || f.name),
          simFields: [...sim.keys()],
        })
        continue
      }
      if (goCmd.args.kind !== 'struct') {
        if (sim.length > 0) {
          report.diffs.push({
            kind: 'argNameDiff',
            component: name,
            command: goCmd.name,
            detail: `Go 该命令不接受参数（${goCmd.args.kind}），Simulator 声明了 ${sim.size} 个`,
            goFields: [],
            simFields: [...sim.keys()],
          })
        }
        continue
      }

      for (const [key, goField] of goArgs) {
        if (!sim.has(key)) {
          report.diffs.push({
            kind: 'argNameDiff',
            component: name,
            command: goCmd.name,
            detail: `Go 参数 ${key}(${goField.type}) 在 Simulator 侧缺失`,
            goFields: [key],
            simFields: [...sim.keys()],
          })
          continue
        }
        // 必填判定只在 Go 侧"确定"时比较：unknown 不参与
        if (goField.required === 'required' && !sim.get(key).required) {
          report.diffs.push({
            kind: 'requiredDiff',
            component: name,
            command: goCmd.name,
            detail: `参数 ${key}：Go 分派分支显式拒绝空值，Simulator 未标 required`,
            goFields: [key],
            simFields: [key],
          })
        }
      }
      for (const key of sim.keys()) {
        if (!goArgs.has(key)) {
          report.diffs.push({
            kind: 'argNameDiff',
            component: name,
            command: goCmd.name,
            detail: `Simulator 参数 ${key} 在 Go 参数结构体中不存在`,
            goFields: [...goArgs.keys()],
            simFields: [key],
          })
        }
      }
    }

    for (const act of simActs) {
      if (!goActs.has(act)) {
        report.diffs.push({
          kind: 'extraCommand',
          component: name,
          command: act,
          detail: 'Simulator 发明的命令，Go 侧无对应分派分支',
        })
      }
    }
  }

  report.counts.simCommands += 0
  report.total = report.diffs.length
  report.byKind = {}
  for (const kind of DIFF_KINDS) {
    report.byKind[kind] = report.diffs.filter((d) => d.kind === kind).length
  }
  return report
}

// ── 报告渲染 ────────────────────────────────────────────────

export function render(report, { verbose = false } = {}) {
  const lines = []
  lines.push('=== FasterEdge ↔ Simulator 命令契约差分 ===')
  lines.push(`Go 组件 ${report.counts.goComponents} / Simulator 组件 ${report.counts.simComponents}`)
  lines.push(`Go 命令 ${report.counts.goCommands} 条，差分 ${report.total} 项`)
  lines.push(
    '分类：' +
      DIFF_KINDS.map((k) => `${k}=${report.byKind[k]}`).join('  '),
  )
  if (report.missingComponents.length) {
    lines.push(`\n缺失组件（Go 有、Simulator 无）：${report.missingComponents.join(', ')}`)
  }
  if (report.extraComponents.length) {
    lines.push(`\n多余组件（Simulator 有、Go 无）：${report.extraComponents.join(', ')}`)
  }
  for (const kind of DIFF_KINDS) {
    const items = report.diffs.filter((d) => d.kind === kind)
    if (!items.length) continue
    lines.push(`\n[${kind}] ${items.length} 项`)
    for (const d of items) {
      lines.push(`  ${d.component}.${d.command} — ${d.detail}`)
    }
  }
  if (!verbose) {
    lines.push('\n（--verbose 输出每条差分的完整字段对照）')
  } else {
    lines.push('\n完整字段对照：')
    for (const d of report.diffs) {
      lines.push(`  ${d.component}.${d.command}`)
      lines.push(`    kind: ${d.kind}`)
      if (d.goFields) lines.push(`    go:   ${JSON.stringify(d.goFields)}`)
      if (d.simFields) lines.push(`    sim:  ${JSON.stringify(d.simFields)}`)
    }
  }
  return lines.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────

async function main() {
  const raw = process.argv.slice(2)
  const verbose = raw.includes('--verbose')
  const strict = raw.includes('--strict')
  const positional = raw.filter((a) => !a.startsWith('--'))
  const contractPath = positional[0] ? resolve(positional[0]) : join(simulatorRoot, 'contract.json')

  const contract = loadContract(contractPath)
  const registry = await loadRegistry()
  const report = diff(contract, registry)
  console.log(render(report, { verbose }))

  if (strict) {
    const blocking = report.total
    if (blocking > 0) {
      console.error(`\n--strict: 存在 ${blocking} 项差异，判定为不一致`)
      process.exit(1)
    }
    console.log('\n--strict: 无差异')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
