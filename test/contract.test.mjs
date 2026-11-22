// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
//
// 命令契约比对测试（node --test）：
//   1. 结构自检：比对器必须能从 contract.json 与真实 registry 算出差异；
//   2. 基线断言：差异数量必须等于 contract-baseline.json 的记录，
//      任何一侧新增/删除命令或参数都会让这里红，逼人先看 diff 再决定
//      "补齐代码" 还是 "修改基线"——不允许无声漂移。
//
// 基线文件与 contract.json 同目录生成：
//   node tools/contract/compare.mjs --baseline > contract-baseline.json

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadContract, loadRegistry, diff, render } from '../tools/contract/compare.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const simulatorRoot = resolve(here, '..')
const contractPath = join(simulatorRoot, 'contract.json')
const baselinePath = join(simulatorRoot, 'contract-baseline.json')

test('contract.json 与 Simulator registry 的差异必须等于基线记录', async () => {
  const contract = loadContract(contractPath)
  const registry = await loadRegistry()
  const report = diff(contract, registry)

  assert.ok(report.counts.goComponents > 0, '契约组件数不能为 0')
  assert.ok(report.counts.goCommands > 0, '契约命令数不能为 0')
  assert.ok(registry.length > 0, 'registry 组件数不能为 0')

  if (!existsSync(baselinePath)) {
    // 首次运行：写基线，不失败（否则新克隆仓库一上来就红）
    writeFileSync(baselinePath, JSON.stringify({ counts: report.counts, byKind: report.byKind, total: report.total }, null, 2) + '\n')
    console.log(`契约差异基线已生成：${baselinePath}（total=${report.total}）`)
    return
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'))
  const drift = []
  if (baseline.counts.goComponents !== report.counts.goComponents) {
    drift.push(`Go 组件数 ${baseline.counts.goComponents} -> ${report.counts.goComponents}`)
  }
  if (baseline.counts.simComponents !== report.counts.simComponents) {
    drift.push(`Simulator 组件数 ${baseline.counts.simComponents} -> ${report.counts.simComponents}`)
  }
  if (baseline.counts.goCommands !== report.counts.goCommands) {
    drift.push(`Go 命令数 ${baseline.counts.goCommands} -> ${report.counts.goCommands}`)
  }
  if (baseline.total !== report.total) drift.push(`差异总数 ${baseline.total} -> ${report.total}`)
  for (const [kind, n] of Object.entries(report.byKind)) {
    if (baseline.byKind[kind] !== n) {
      drift.push(`${kind} ${baseline.byKind[kind]} -> ${n}`)
    }
  }
  assert.equal(drift.length, 0, `契约差异偏离基线，需重新审查：\n${drift.join('\n')}\n\n${render(report)}`)
})

test('比对器必须能报出 missingCommand 与 extraCommand（差分器本身有效）', async () => {
  const contract = loadContract(contractPath)
  // 伪造一份"缺一个命令、多一个命令"的 registry，确认差分器真的在算，
  // 而不是恒真。
  const registry = await loadRegistry()
  const mutated = registry.map((c) => ({ ...c, commands: { ...c.commands } }))
  const first = mutated[0]
  const acts = Object.keys(first.commands)
  assert.ok(acts.length > 1, 'registry 首个组件至少要有 2 条命令')
  const victim = acts[0]
  delete first.commands[victim]
  first.commands['invented_by_test'] = []
  const report = diff(contract, mutated)
  assert.ok(report.diffs.some((d) => d.kind === 'missingCommand' && d.command === victim), '应报出 missingCommand')
  assert.ok(
    report.diffs.some((d) => d.kind === 'extraCommand' && d.command === 'invented_by_test'),
    '应报出 extraCommand',
  )
})

test('比对器必须检出参数名不一致（差分器本身有效）', async () => {
  const contract = loadContract(contractPath)
  const registry = await loadRegistry()
  const mutated = registry.map((c) => ({ ...c, commands: { ...c.commands } }))
  const target = mutated.find((c) => c.name === 'RoleAbility')
  assert.ok(target, 'RoleAbility 必须存在')
  const setRole = target.commands.set_role
  assert.ok(setRole && setRole.length > 0, 'RoleAbility.set_role 必须有参数声明')
  setRole[0] = { ...setRole[0], key: 'Renamed' }
  const report = diff(contract, mutated)
  assert.ok(
    report.diffs.some((d) => d.kind === 'argNameDiff' && d.command === 'set_role'),
    '改名后应报出 argNameDiff',
  )
})
