// ─────────────────────────────────────────────────────────────
// FasterEdge 开源项目
// Github: https://github.com/FasterEdge
// Gitee:  https://gitee.com/FasterEdge
// ─────────────────────────────────────────────────────────────
// 命令执行 trace 的录制 / 回放测试（node --test）
// 覆盖：record → JSON → replay 后逐条命令日志与终态一致；确定性环境真实生效
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorld, addNode, attachComponent, resetId } from '../src/core/world.js'
import { runCommand } from '../src/core/engine.js'
import { buildExampleWorld, serializeWorld, hydrateWorld } from '../src/core/persistence.js'
import { runScenario, sampleScenarios } from '../src/core/testrunner.js'
import {
  recordTrace,
  replayTrace,
  traceToJSON,
  traceFromJSON,
  commandsFromScenario,
  withDeterminism,
  canonicalJson,
  diffValues,
  DEFAULT_TRACE_NOW,
} from '../src/core/trace.js'

// 示例命令序列：覆盖数据读写、令牌、MQTT 跨节点路由、虚拟 FS
function exampleCommands(world) {
  const edge2 = world.nodes.find((n) => n.name === 'edge-02')
  const cloud = world.nodes.find((n) => n.name === 'cloud-ctl')
  return [
    { node: 'cloud-ctl', component: 'OneKeyAbility', act: 'issue_token', args: { Subject: 'edge-01', TTL: 3600 } },
    { node: 'cloud-ctl', component: 'NetMapAbility', act: 'register_peer', args: { Name: 'edge-09', Address: '10.0.0.9:7000', Role: 'edge' } },
    { node: 'edge-02', component: 'MQTTAbility', act: 'subscribe', args: { Topic: 'edge/+/status', Qos: 0 } },
    { node: 'edge-02', component: 'MQTTAbility', act: 'connect', args: {} },
    { node: 'cloud-ctl', component: 'MQTTAbility', act: 'publish', args: { Topic: 'edge/01/status', Payload: 'online', Qos: 0 } },
    { node: 'edge-02', component: 'MQTTAbility', act: 'drain', args: {} },
    { node: 'edge-01', component: 'ConfigData', act: 'set', args: { Key: 'server.port', Value: '8080' } },
    { node: 'edge-01', component: 'ConfigFileAbility', act: 'save', args: {} },
    { node: 'edge-01', component: 'CmdAbility', act: 'run', args: { Command: 'echo hello-fastedge' } },
  ]
}

test('录制：trace 记录初始世界、逐条命令输出与日志、终态', async () => {
  const world = buildExampleWorld()
  const cmds = exampleCommands(world)
  const trace = await recordTrace(world, cmds, { name: '示例录制' })

  assert.equal(trace.version, 1)
  assert.equal(trace.name, '示例录制')
  assert.equal(trace.determinism.now, DEFAULT_TRACE_NOW)
  assert.equal(trace.initialWorld.nodes.length, 3)
  assert.equal(trace.steps.length, cmds.length)
  for (const step of trace.steps) {
    assert.equal(step.out.Err, null, `步骤 ${step.component}.${step.act} 应成功`)
    assert.ok(step.log, `步骤 ${step.component}.${step.act} 应写入命令日志`)
  }
  // 终态包含序列化后的节点数据与日志
  assert.ok(trace.finalState.nodes.length === 3)
  assert.ok(trace.finalState.logs.length >= cmds.length)
})

test('回放：同一 trace 从初始世界重建后命令日志与终态完全一致', async () => {
  const world = buildExampleWorld()
  const trace = await recordTrace(world, exampleCommands(world), { name: '回放一致性' })
  const restored = await replayTrace(traceFromJSON(traceToJSON(trace)))

  assert.equal(restored.pass, true, JSON.stringify(restored.diffs.slice(0, 5), null, 2))
  assert.equal(restored.total, trace.steps.length)
  assert.equal(restored.failedSteps, 0)
  assert.equal(restored.statePass, true)
})

test('回放：终态逐字节等于录制时序列化结果', async () => {
  const world = buildExampleWorld()
  const trace = await recordTrace(world, exampleCommands(world), { name: '终态相等' })
  const restored = await replayTrace(trace)

  // 回放世界在确定性环境下序列化，应与录制终态完全一致（含时钟/日志/随机 id）
  const restoredJson = await withDeterminism(trace.determinism, () => canonicalJson(serializeWorld(restored.world)))
  const recordedJson = await withDeterminism(trace.determinism, () => canonicalJson(serializeWorld(world)))
  assert.equal(restoredJson, recordedJson)
})

test('回放：命令序列本身被真实执行，不是空跑', async () => {
  const world = buildExampleWorld()
  const cmds = exampleCommands(world)
  const trace = await recordTrace(world, cmds, { name: '非空跑' })
  const restored = await replayTrace(trace)

  // 逐条命令的 Value 都是录制时真实产出（含 OneKey 签名、MQTT 投递数）
  const issueStep = trace.steps[0]
  assert.ok(issueStep.out.Value.Signature, 'OneKey 令牌应含签名')
  const publishStep = trace.steps.find((s) => s.component === 'MQTTAbility' && s.act === 'publish')
  assert.ok(publishStep.out.Value.delivered >= 1, 'MQTT 应真实投递给订阅方')
  assert.ok(restored.pass)
})

test('回放：篡改录制值后必须被发现（负向）', async () => {
  const world = buildExampleWorld()
  const trace = await recordTrace(world, exampleCommands(world), { name: '可检测' })
  // 篡改一条命令的 Value：回放必须不一致，且差异定位到该步
  const target = trace.steps.findIndex((s) => s.component === 'ConfigData' && s.act === 'set')
  trace.steps[target].out.Value = '9999'

  const restored = await replayTrace(trace)
  assert.equal(restored.pass, false)
  assert.ok(restored.failedSteps >= 1)
  assert.ok(restored.diffs.some((d) => d.step === target && d.path.startsWith('out.Value')), JSON.stringify(restored.diffs))
})

test('回放：篡改终态后必须被发现（负向）', async () => {
  const world = buildExampleWorld()
  const trace = await recordTrace(world, exampleCommands(world), { name: '终态可检测' })
  const node = trace.finalState.nodes.find((n) => n.name === 'edge-01')
  node.data.ConfigData.values['server.port'] = '9999'

  const restored = await replayTrace(trace)
  assert.equal(restored.pass, false)
  assert.equal(restored.statePass, false)
  assert.ok(restored.diffs.some((d) => d.path.includes('ConfigData.values')), JSON.stringify(restored.diffs))
})

test('回放：不支持的 trace 版本给出明确失败', async () => {
  const restored = await replayTrace({ version: 99, name: 'future', steps: [] })
  assert.equal(restored.pass, false)
  assert.match(restored.reason, /不支持的 trace 版本/)
})

test('回放：节点缺失时按步标记失败而不是整体崩溃', async () => {
  const world = buildExampleWorld()
  const trace = await recordTrace(world, exampleCommands(world), { name: '缺节点' })
  trace.initialWorld.nodes = trace.initialWorld.nodes.filter((n) => n.name !== 'edge-02')
  trace.steps = trace.steps.filter((s) => s.node !== 'edge-02')

  const restored = await replayTrace(trace)
  assert.equal(restored.pass, false)
  assert.ok(restored.steps.length >= 1)
  assert.ok(restored.steps.every((s) => typeof s.pass === 'boolean'))
})

test('确定性环境：固定时钟与固定随机源，两次执行结果完全相同', async () => {
  // 世界构建也在确定性环境内完成，随机 clientId/secret 与时间戳都被钉死；
  // 节点 id 来自全局计数器，用 resetId() 让两次构建从同一起点开始
  async function build() {
    return withDeterminism({ now: DEFAULT_TRACE_NOW, seed: 1 }, async () => {
      resetId()
      const world = createWorld()
      const node = addNode(world, 'custom', 'det-node', 0, 0)
      attachComponent(world, node.id, 'KeyringData')
      attachComponent(world, node.id, 'MQTTAbility')
      return recordTrace(world, [
        { node: 'det-node', component: 'KeyringData', act: 'rotate', args: {} },
        { node: 'det-node', component: 'KeyringData', act: 'issue_token', args: { Subject: 'x', TTL: 60 } },
        { node: 'det-node', component: 'KeyringData', act: 'status', args: {} },
      ], { name: '确定性' })
    })
  }
  const t1 = await build()
  const t2 = await build()
  assert.equal(canonicalJson(t1.steps), canonicalJson(t2.steps))
  assert.equal(canonicalJson(t1.finalState), canonicalJson(t2.finalState))
})

test('确定性环境：构建期随机值即使不固定也被完整捕获进 initialWorld（回放仍一致）', async () => {
  // 对照上一条：世界在确定性环境外构建 → 两次的 clientId/secret 不同，
  // 但它们被序列化进 initialWorld，回放时原样复用，故回放仍逐字节一致
  async function build() {
    const world = createWorld()
    const node = addNode(world, 'custom', 'det-node', 0, 0)
    attachComponent(world, node.id, 'KeyringData')
    attachComponent(world, node.id, 'MQTTAbility')
    return recordTrace(world, [
      { node: 'det-node', component: 'KeyringData', act: 'status', args: {} },
    ], { name: '捕获随机值' })
  }
  const t1 = await build()
  const t2 = await build()
  const c1 = t1.initialWorld.nodes[0].abilities.MQTTAbility.clientId
  const c2 = t2.initialWorld.nodes[0].abilities.MQTTAbility.clientId
  assert.notEqual(c1, c2, '构建期随机值两次应不同（证明随机源真实生效）')

  const r1 = await replayTrace(t1)
  const r2 = await replayTrace(t2)
  assert.equal(r1.pass, true)
  assert.equal(r2.pass, true)
  assert.equal(r1.world.nodes[0].abilities.MQTTAbility.clientId, c1)
  assert.equal(r2.world.nodes[0].abilities.MQTTAbility.clientId, c2)
})

test('确定性环境：默认使用内置固定基准，且可被自定义 env 覆盖', async () => {
  const seen = []
  await withDeterminism(undefined, async () => {
    seen.push(Date.now(), new Date().toISOString())
  })
  assert.equal(seen[0], DEFAULT_TRACE_NOW)
  assert.equal(seen[1], new Date(DEFAULT_TRACE_NOW).toISOString())

  const seen2 = []
  await withDeterminism({ now: 1000, seed: 42 }, async () => {
    seen2.push(Date.now())
    const buf = new Uint8Array(2)
    crypto.getRandomValues(buf)
    seen2.push(Array.from(buf).join(','))
  })
  assert.equal(seen2[0], 1000)
  // 同一 seed 两次取样结果相同，不同 seed 结果不同
  const again = []
  await withDeterminism({ now: 1000, seed: 42 }, async () => {
    const buf = new Uint8Array(2)
    crypto.getRandomValues(buf)
    again.push(Array.from(buf).join(','))
  })
  const other = []
  await withDeterminism({ now: 1000, seed: 43 }, async () => {
    const buf = new Uint8Array(2)
    crypto.getRandomValues(buf)
    other.push(Array.from(buf).join(','))
  })
  assert.equal(seen2[1], again[0])
  assert.notEqual(seen2[1], other[0])
})

test('确定性环境：结束后恢复真实时钟与真实随机源', async () => {
  const before = Date.now()
  await withDeterminism({ now: 1 }, async () => {})
  const after = Date.now()
  assert.equal(after, before)
  assert.ok(Date.now() > 1)
  // 随机源恢复：两次连续取值应大概率不同（真实 crypto 随机）
  const a = new Uint8Array(4)
  const b = new Uint8Array(4)
  crypto.getRandomValues(a)
  crypto.getRandomValues(b)
  assert.notEqual(Array.from(a).join(','), Array.from(b).join(','))
})

test('确定性环境：不替换掉 crypto.subtle 等真实能力', async () => {
  const digest = await withDeterminism({ now: 1 }, () => crypto.subtle.digest('SHA-256', new Uint8Array([1, 2, 3])))
  assert.equal(new Uint8Array(await digest).length, 32)
})

test('场景步骤可直接转成 trace 命令序列并回放一致', async () => {
  const world = buildExampleWorld()
  const scenario = sampleScenarios()[0]
  // 先跑一次场景（真实执行），再录制同样序列
  await runScenario(world, scenario)
  const trace = await recordTrace(world, commandsFromScenario(scenario), { name: '场景转 trace' })
  const restored = await replayTrace(trace)
  assert.equal(restored.pass, true, JSON.stringify(restored.diffs.slice(0, 5), null, 2))
})

test('回放：错误命令序列同样可复现（负向命令的 Err 也进 trace）', async () => {
  const world = buildExampleWorld()
  const trace = await recordTrace(world, [
    { node: 'cloud-ctl', component: 'OneKeyAbility', act: 'issue_token', args: {} },
    { node: 'cloud-ctl', component: 'NotRealComponent', act: 'x', args: {} },
    { node: 'no-such-node', component: 'BaseData', act: 'info', args: {} },
  ], { name: '错误可复现' })

  assert.ok(trace.steps[0].out.Err && trace.steps[0].out.Err.includes('required'))
  assert.ok(trace.steps[1].out.Err && trace.steps[1].out.Err.includes('not registered'))
  assert.equal(trace.steps[2].out, null)
  assert.ok(trace.steps[2].error.includes('不存在'))

  const restored = await replayTrace(trace)
  assert.equal(restored.pass, true, JSON.stringify(restored.diffs.slice(0, 5), null, 2))
})

test('序列化往返：hydrate 后世界与序列化结果等价（含日志截断与重建）', async () => {
  const world = buildExampleWorld()
  await runCommand(world, world.nodes[1].id, 'ConfigData', 'set', { Key: 'a', Value: '1' })
  const trace = await recordTrace(world, exampleCommands(world), { name: '往返等价' })
  // trace.initialWorld 本身是 serializeWorld 的输出，hydrate 后再序列化应完全一致
  const roundTrip = await withDeterminism(trace.determinism, () => {
    const again = serializeWorld(hydrateWorld(JSON.parse(JSON.stringify(trace.initialWorld))))
    return canonicalJson(again)
  })
  assert.equal(roundTrip, await withDeterminism(trace.determinism, () => canonicalJson(trace.initialWorld)))
})

test('序列化往返：links 在 hydrate 后不丢失（曾被丢失的真实缺陷）', async () => {
  const world = buildExampleWorld()
  const ser = serializeWorld(world)
  assert.equal(ser.links.length, 2)
  const restored = hydrateWorld(JSON.parse(JSON.stringify(ser)))
  assert.equal(restored.links.length, 2)
  // 再序列化一次仍是两条（往返不动点）
  assert.equal(serializeWorld(restored).links.length, 2)
})

test('序列化往返：残缺 links（端点不存在）被过滤而非崩溃', async () => {
  const world = buildExampleWorld()
  const ser = serializeWorld(world)
  ser.links.push({ id: 'link-bad', source: 'node-404', target: world.nodes[0].id })
  const restored = hydrateWorld(JSON.parse(JSON.stringify(ser)))
  assert.equal(restored.links.length, 2)
  assert.ok(!restored.links.some((l) => l.source === 'node-404'))
})

test('序列化往返：时钟快照恢复后模拟时间连续', async () => {
  const world = buildExampleWorld()
  await runCommand(world, world.nodes[0].id, 'TimeAbility', 'advance', { Ms: 5000 })
  const before = world.clock.snapshot()
  const restored = hydrateWorld(JSON.parse(JSON.stringify(serializeWorld(world))))
  const after = restored.clock.snapshot()
  assert.equal(after.advanceMs, before.advanceMs)
  assert.equal(after.offsetMs, before.offsetMs)
  assert.equal(after.scale, before.scale)
  assert.equal(after.frozen, before.frozen)
})

test('diffValues：定位到具体路径，而不是只报「不相等」', () => {
  const diffs = diffValues({ a: { b: [1, 2] }, c: 3 }, { a: { b: [1, 9] }, d: 4 })
  const paths = diffs.map((d) => d.path).sort()
  assert.deepEqual(paths, ['.a.b[1]', '.c', '.d'])
  assert.deepEqual(diffValues(1, 1), [])
})
