// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
// 引擎冒烟测试：不依赖 DOM，直接用 Node 验证核心逻辑
import { createWorld, addNode, attachComponent } from './src/core/world.js'
import { runCommand } from './src/core/engine.js'
import { runScenario, assertOutput } from './src/core/testrunner.js'
import { buildExampleWorld } from './src/core/persistence.js'
import { sampleScenarios } from './src/core/testrunner.js'

let failures = 0
function check(name, cond, extra = '') {
  if (cond) console.log('  ✅', name)
  else {
    failures++
    console.log('  ❌', name, extra)
  }
}

console.log('=== 冒烟测试 ===')

// 1. 基础世界 + 命令
const w = buildExampleWorld()
check('示例世界有 3 节点', w.nodes.length === 3)
const cloud = w.nodes[0]
const edge1 = w.nodes[1]

let out = await runCommand(w, cloud.id, 'BaseData', 'info', {})
check('BaseData.info 成功', !out.Err, JSON.stringify(out))

out = await runCommand(w, cloud.id, 'NetMapAbility', 'register_peer', { Name: 'edge-09', Address: '10.0.0.9:7000', Role: 'edge' })
check('NetMapAbility.register_peer 成功', !out.Err && out.Value.name === 'edge-09', JSON.stringify(out))

out = await runCommand(w, cloud.id, 'NetMapAbility', 'list_peers', {})
check('NetMapAbility.list_peers 含新对端', !out.Err && JSON.stringify(out.Value).includes('edge-09'))

// 2. OneKey 令牌
out = await runCommand(w, cloud.id, 'OneKeyAbility', 'issue_token', { Subject: 'edge-01', TTL: 3600 })
check('OneKey.issue_token 成功', !out.Err && out.Value.Signature, JSON.stringify(out).slice(0, 200))
const token = out.Value
out = await runCommand(w, cloud.id, 'OneKeyAbility', 'verify_token', { Subject: 'edge-01', IssuedAt: token.IssuedAt, ExpiresAt: token.ExpiresAt, Signature: token.Signature })
check('OneKey.verify_token 通过', !out.Err && out.Value === 'edge-01', JSON.stringify(out).slice(0, 200))

out = await runCommand(w, cloud.id, 'OneKeyAbility', 'verify_token', { Subject: 'edge-01', IssuedAt: token.IssuedAt, ExpiresAt: token.ExpiresAt, Signature: 'tampered-sig' })
check('OneKey.verify_token 篡改失败', out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))

// 3. 依赖缺失（手工构造：去掉 NetMapData 再调 NetMapAbility）
const cloud2 = w.nodes.find((n) => n.name === 'cloud-ctl')
delete cloud2.data.NetMapData
out = await runCommand(w, cloud2.id, 'NetMapAbility', 'list_peers', {})
check('NetMapAbility 缺依赖报错', out.Err && out.Err.includes('dependency is missing'), JSON.stringify(out).slice(0, 200))
attachComponent(w, cloud2.id, 'NetMapData')
out = await runCommand(w, cloud2.id, 'InfluxDBAbility', 'ping', {})
check('InfluxDBAbility 未挂载报 not mounted', out.Err && out.Err.includes('not mounted'), JSON.stringify(out).slice(0, 200))
attachComponent(w, cloud2.id, 'InfluxDBData')
attachComponent(w, cloud2.id, 'InfluxDBAbility')
out = await runCommand(w, cloud2.id, 'InfluxDBAbility', 'set_endpoint', { Endpoint: 'http://sim:8086' })
check('挂载后 InfluxDBAbility.set_endpoint 成功', !out.Err, JSON.stringify(out))

// 4. 未知命令 / 未知组件
out = await runCommand(w, cloud.id, 'BaseData', 'nonexistent_cmd', {})
check('未知命令报 unsupported', out.Err && out.Err.includes('unsupported'), JSON.stringify(out))
out = await runCommand(w, cloud.id, 'NotRealComponent', 'x', {})
check('未知组件报 not registered', out.Err && out.Err.includes('not registered'), JSON.stringify(out))

// 5. 参数校验
out = await runCommand(w, cloud.id, 'OneKeyAbility', 'issue_token', {})
check('缺少必填参数报错', out.Err && out.Err.includes('required'), JSON.stringify(out))

// 6. MQTT 跨节点
out = await runCommand(w, edge1.id, 'MQTTAbility', 'subscribe', { Topic: 'edge/+/status' })
check('edge-01 subscribe', !out.Err, JSON.stringify(out))
out = await runCommand(w, edge1.id, 'MQTTAbility', 'connect', {})
check('edge-01 connect', !out.Err, JSON.stringify(out))
out = await runCommand(w, cloud.id, 'MQTTAbility', 'connect', {})
check('cloud connect', !out.Err, JSON.stringify(out))
out = await runCommand(w, cloud.id, 'MQTTAbility', 'publish', { Topic: 'edge/01/status', Payload: 'online' })
check('cloud publish 路由', !out.Err && out.Value.delivered >= 1, JSON.stringify(out))
out = await runCommand(w, edge1.id, 'MQTTAbility', 'drain', {})
check('edge-01 收到消息', !out.Err && JSON.stringify(out.Value).includes('online'), JSON.stringify(out).slice(0, 200))

// 7. 配置读写 + ConfigFile
out = await runCommand(w, edge1.id, 'ConfigData', 'set', { Key: 'server.port', Value: '8080' })
check('ConfigData.set', !out.Err, JSON.stringify(out))
out = await runCommand(w, edge1.id, 'ConfigData', 'get', { Key: 'server.port' })
check('ConfigData.get 回读', !out.Err && out.Value === '8080', JSON.stringify(out))
out = await runCommand(w, edge1.id, 'ConfigFileAbility', 'save', {})
check('ConfigFile.save', !out.Err, JSON.stringify(out))
out = await runCommand(w, edge1.id, 'ConfigData', 'delete', { Key: 'server.port' })
check('ConfigData.delete', !out.Err, JSON.stringify(out))
out = await runCommand(w, edge1.id, 'ConfigData', 'get', { Key: 'server.port' })
check('删除后 get 报错', !!out.Err, JSON.stringify(out))
out = await runCommand(w, edge1.id, 'ConfigFileAbility', 'load', {})
check('ConfigFile.load', !out.Err, JSON.stringify(out))
out = await runCommand(w, edge1.id, 'ConfigData', 'get', { Key: 'server.port' })
check('加载后回读 8080', !out.Err && out.Value === '8080', JSON.stringify(out))

// 8. 终端模拟
out = await runCommand(w, edge1.id, 'CmdAbility', 'run', { Command: 'echo hello-fastedge' })
check('Cmd.run echo', !out.Err && JSON.stringify(out.Value).includes('hello-fastedge'), JSON.stringify(out))
out = await runCommand(w, edge1.id, 'CmdAbility', 'run', { Command: 'cat /etc/hostname' })
check('Cmd.run cat 虚拟FS', !out.Err, JSON.stringify(out))

// 9. 测试运行器
const sc = sampleScenarios()[0] // MQTT 示例
const res = await runScenario(w, sc)
check('示例场景 MQTT 全通过', res.failed === 0 && res.passed === sc.steps.length, JSON.stringify(res))

// 10. 断言函数
const okOut = { Name: 'x', Value: 'hello world', Err: null }
const badOut = { Name: 'x', Value: null, Err: 'invalid: something' }
check('断言 success=true 通过', assertOutput(okOut, { success: true }).pass)
check('断言 success=false 通过', assertOutput(badOut, { success: false }).pass)
check('断言 valueContains 通过', assertOutput(okOut, { valueContains: 'world' }).pass)
check('断言 valueContains 失败', !assertOutput(okOut, { valueContains: 'zzz' }).pass)
check('断言 errContains 通过', assertOutput(badOut, { errContains: 'invalid' }).pass)

// 11. 角色门控
out = await runCommand(w, cloud.id, 'CloudRoleAbility', 'set_controller', { Address: 'http://10.0.0.1:7000' })
check('cloud 节点 CloudRole.set_controller 成功', !out.Err, JSON.stringify(out))
attachComponent(w, edge1.id, 'CloudRoleAbility')
out = await runCommand(w, edge1.id, 'CloudRoleAbility', 'set_controller', { Address: 'http://10.0.0.1:7000' })
check('edge 节点 CloudRole 拒绝', out.Err && out.Err.includes('cloud'), JSON.stringify(out))

// 12. 挂载/卸载
const w2 = createWorld()
const n2 = addNode(w2, 'custom', 't-node', 0, 0)
check('custom 模板只有 Base', Object.keys(n2.data).length === 1 && !!n2.data.BaseData)
attachComponent(w2, n2.id, 'NetMapData')
check('挂载 NetMapData 成功', !!n2.data.NetMapData)
attachComponent(w2, n2.id, 'NetMapAbility')
check('挂载 NetMapAbility 成功', !!n2.abilities.NetMapAbility)
out = await runCommand(w2, n2.id, 'NetMapAbility', 'register_peer', { Name: 'a', Address: '10.1.1.1:1' })
check('自定义节点 NetMap 命令成功', !out.Err, JSON.stringify(out))

// 13. attachComponent 递归补齐 Ability 依赖（CloudRoleAbility 依赖 RoleAbility）
attachComponent(w2, n2.id, 'CloudRoleAbility')
check('自动补齐 RoleAbility 依赖', !!n2.abilities.RoleAbility && !!n2.abilities.CloudRoleAbility)

// 14. 序列化→反序列化 往返后 MQTT Broker 订阅仍生效（跨节点路由）
const { serializeWorld, hydrateWorld } = await import('./src/core/persistence.js')
const w3 = buildExampleWorld()
const e31 = w3.nodes.find((n) => n.name === 'edge-01')
const e32 = w3.nodes.find((n) => n.name === 'edge-02')
await runCommand(w3, e32.id, 'MQTTAbility', 'subscribe', { Topic: 'edge/+/status' })
await runCommand(w3, e32.id, 'MQTTAbility', 'connect', {})
const restored = hydrateWorld(serializeWorld(w3))
const re32 = restored.nodes.find((n) => n.name === 'edge-02')
await runCommand(restored, re32.id, 'MQTTAbility', 'connect', {}) // 保持 connected 状态
out = await runCommand(restored, e31.name === 'edge-01' ? restored.nodes.find((n) => n.name === 'edge-01').id : '', 'MQTTAbility', 'publish', { Topic: 'edge/01/status', Payload: 'hello-after-hydrate' })
check('hydrate 后 MQTT 跨节点路由恢复', !out.Err && out.Value.delivered >= 1, JSON.stringify(out).slice(0, 200))

// 15. bool 参数引擎层正确解析字符串 'false'
const edgeForBool = w.nodes.find((n) => n.name === 'edge-01')
out = await runCommand(w, edgeForBool.id, 'EdgeRoleAbility', 'set_online', { Online: 'false' })
check("bool 参数 'false' 解析为 false", !out.Err && out.Value === false, JSON.stringify(out))

// 16. hydrate 后新增节点 id 不与旧节点冲突
const restored2 = hydrateWorld(serializeWorld(w))
addNode(restored2, 'custom', 'after-load', 0, 0)
const ids = restored2.nodes.map((n) => n.id)
const idCollision = ids.length !== new Set(ids).size
check('hydrate 后新增节点 id 不冲突', !idCollision, `ids=${ids.join(',')}`)

// 17. 数据库 configure 后 status.configured === true
const dbNode = addNode(restored2, 'db', 'db-01', 10, 10)
out = await runCommand(restored2, dbNode.id, 'MySQLData', 'configure', { Host: 'db.local', Port: 3306 })
check('db configure 成功', !out.Err, JSON.stringify(out).slice(0, 150))
out = await runCommand(restored2, dbNode.id, 'MySQLData', 'status', {})
check('db status.configured === true', !out.Err && out.Value.configured === true, JSON.stringify(out))
// 模板自带的 InfluxDBAbility 依赖 InfluxDBData 已满足（edge/sensor 模板）
const eNode = addNode(restored2, 'edge', 'edge-tpl', 20, 20)
out = await runCommand(restored2, eNode.id, 'InfluxDBAbility', 'list_series', {})
check('edge 模板 InfluxDBAbility 依赖已满足', !out.Err, JSON.stringify(out).slice(0, 150))

// 18. 递归能力依赖：挂 AlgorithmDistributionAbility 自动补 NetMapData/NetMapAbility/FileTransferAbility
const cust2 = addNode(restored2, 'custom', 'c2', 30, 30)
attachComponent(restored2, cust2.id, 'AlgorithmDistributionAbility')
const hasAll = !!(cust2.data.NetMapData && cust2.abilities.NetMapAbility && cust2.abilities.FileTransferAbility)
check('递归补齐能力依赖', hasAll, JSON.stringify({ data: Object.keys(cust2.data), ab: Object.keys(cust2.abilities) }))
out = await runCommand(restored2, cust2.id, 'AlgorithmDistributionAbility', 'list_distributions', {})
check('递归依赖后命令可执行', !out.Err, JSON.stringify(out).slice(0, 150))

// 19. hydrate 步骤归一化：缺 expect 的旧步骤不崩且可渲染
const worldWithOldStep = hydrateWorld({
  name: 'old',
  nodes: [],
  links: [],
  scenarios: [{ id: 's1', name: '老场景', steps: [{ id: 'x', name: '旧步骤', node: '', component: '', command: '', args: '{"a":1}' }] }],
})
check('旧步骤 expect 被归一化', worldWithOldStep.scenarios[0].steps[0].expect?.success === 'any' && worldWithOldStep.scenarios[0].steps[0].args === '{"a":1}')

// 20. 序列化日志截断到最近 200 条
const bigLogWorld = createWorld()
for (let i = 0; i < 250; i++) bigLogWorld.logs.push({ ts: i, nodeName: 'x', component: 'c', act: 'a', value: i })
const serLogs = serializeWorld(bigLogWorld).logs.length
check('持久化日志截断到 200', serLogs === 200, `len=${serLogs}`)

// 21. allowlist：空表拒绝；前缀精确（ls 不放行 lsblk）；set_allowlist 后放行
const aw = createWorld()
const awNode = addNode(aw, 'custom', 'aw-node', 0, 0)
attachComponent(aw, awNode.id, 'CmdAbility')
await runCommand(aw, awNode.id, 'CmdAbility', 'set_allowlist', { Commands: [] })
out = await runCommand(aw, awNode.id, 'CmdAbility', 'run', { Command: 'echo hi' })
check('allowlist 空表拒绝命令', !!out.Err && out.Err.includes('allowlist'), JSON.stringify(out))
await runCommand(aw, awNode.id, 'CmdAbility', 'set_allowlist', { Commands: ['ls'] })
out = await runCommand(aw, awNode.id, 'CmdAbility', 'run', { Command: 'lsblk' })
check('allowlist 前缀精确（ls 不放行 lsblk）', !!out.Err, JSON.stringify(out))
out = await runCommand(aw, awNode.id, 'CmdAbility', 'run', { Command: 'ls /' })
check('allowlist 精确命令放行', !out.Err, JSON.stringify(out))

// 21b. set_allowlist_any：fail-closed 下必须显式 opt-in 才能全放行（对齐主仓库 Cmd/Sh/BashCommandSetAllowAny）
out = await runCommand(aw, awNode.id, 'CmdAbility', 'set_allowlist_any', { Any: true })
check('set_allowlist_any 返回放行态', !out.Err && out.Value === true, JSON.stringify(out))
out = await runCommand(aw, awNode.id, 'CmdAbility', 'run', { Command: 'lsblk' })
check('allowAny 后任意命令放行', !out.Err, JSON.stringify(out))
out = await runCommand(aw, awNode.id, 'CmdAbility', 'set_allowlist_any', { Any: false })
check('set_allowlist_any(false) 回到 fail-closed', !out.Err && out.Value === false, JSON.stringify(out))
out = await runCommand(aw, awNode.id, 'CmdAbility', 'run', { Command: 'echo hi' })
check('allowAny 关闭后重新拒绝', !!out.Err && out.Err.includes('allowlist'), JSON.stringify(out))
out = await runCommand(aw, awNode.id, 'CmdAbility', 'set_allowlist_any', {})
check('set_allowlist_any 缺必填参数被拒绝', !!out.Err && out.Err.includes('missing required'), JSON.stringify(out))

// 22. Keyring 指纹不回显明文密钥
const kw = createWorld()
const kn = addNode(kw, 'custom', 'kr-node', 0, 0)
attachComponent(kw, kn.id, 'KeyringData')
const krPre = kn.data.KeyringData.secret
out = await runCommand(kw, kn.id, 'KeyringData', 'status', {})
const finger = out.Value.secretFinger
check('密钥指纹非明文前缀', !finger.includes(krPre.slice(0, 8)) && /^[0-9a-f]{16}$/.test(finger), `finger=${finger}`)

// 23. 负 TTL 报错
out = await runCommand(kw, kn.id, 'KeyringData', 'issue_token', { Subject: 'x', TTL: -5 })
check('负 TTL 被拒绝', !!out.Err && out.Err.includes('ttl must be positive'), JSON.stringify(out))

// 24. SQLiteData 无 set_secret/clear_secret（_withSecret=false）
const dbw = createWorld()
const dbn = addNode(dbw, 'db', 'db-node', 0, 0)
out = await runCommand(dbw, dbn.id, 'SQLiteData', 'set_secret', { Secret: 'abcd' })
check('SQLiteData 无 set_secret 命令', !!out.Err && out.Err.includes('unsupported'), JSON.stringify(out))
out = await runCommand(dbw, dbn.id, 'SQLiteData', 'status', {})
check('SQLiteData status 字段对齐', !out.Err && 'secretConfigured' in out.Value, JSON.stringify(out))

// 25. MQTT drain 未订阅报错；角色门控全命令
const mw = buildExampleWorld()
const me1 = mw.nodes.find((n) => n.name === 'edge-01')
out = await runCommand(mw, me1.id, 'MQTTAbility', 'drain', { Topic: 'edge/+/status' })
check('drain 未订阅主题报错', !!out.Err && out.Err.includes('not subscribed'), JSON.stringify(out))
// 无角色节点挂 EdgeRoleAbility，任意命令都应被门控拒绝
const rw = createWorld()
const rn = addNode(rw, 'custom', 'role-node', 0, 0)
attachComponent(rw, rn.id, 'EdgeRoleAbility')
out = await runCommand(rw, rn.id, 'EdgeRoleAbility', 'get_zone', {})
check('EdgeRole 无角色时全命令拒绝（get_zone）', !!out.Err && out.Err.includes('role=edge'), JSON.stringify(out))

// __SUMMARY__

// ════════════════════════════════════════════════════════════
// 26. 模拟时钟：clockOffsetMs 真正生效 + 手动推进 / 快进 / 冻结
// ════════════════════════════════════════════════════════════
const cw = buildExampleWorld()
const cn = cw.nodes[0]
out = await runCommand(cw, cn.id, 'TimeAbility', 'set_offset', { OffsetMs: 3600000 })
check('TimeAbility.set_offset 设置世界时钟偏移', !out.Err && out.Value.offsetMs === 3600000, JSON.stringify(out))
out = await runCommand(cw, cn.id, 'TimeAbility', 'clock_status', {})
const drifted = Date.parse(out.Value.time) - Date.now()
check('offset 生效：世界时间比系统时间快 1 小时', out.Value.offsetMs === 3600000 && Math.abs(drifted - 3600000) < 5000, `drift=${drifted}`)
out = await runCommand(cw, cn.id, 'TimeAbility', 'advance', { Ms: 1000 })
check('TimeAbility.advance 推进 1 秒', !out.Err && out.Value.advanceMs === 1000, JSON.stringify(out).slice(0, 200))
out = await runCommand(cw, cn.id, 'TimeAbility', 'advance', { Ms: 5000 })
check('advance 可累加', !out.Err && out.Value.advanceMs === 6000, JSON.stringify(out).slice(0, 200))
out = await runCommand(cw, cn.id, 'TimeAbility', 'set_scale', { Scale: 0 })
check('TimeAbility.set_scale 设置倍率', !out.Err && out.Value.scale === 0, JSON.stringify(out).slice(0, 200))
const pausedA = cw.clock.now()
await new Promise((r) => setTimeout(r, 40))
check('scale=0 时世界时钟停走', Math.abs(cw.clock.now() - pausedA) < 2, `delta=${cw.clock.now() - pausedA}`)
out = await runCommand(cw, cn.id, 'TimeAbility', 'set_scale', { Scale: 10 })
check('TimeAbility.set_scale 快进 10x', !out.Err && out.Value.scale === 10, JSON.stringify(out).slice(0, 200))
out = await runCommand(cw, cn.id, 'TimeAbility', 'freeze', { Frozen: true })
check('TimeAbility.freeze 冻结时钟', !out.Err && out.Value.frozen === true, JSON.stringify(out).slice(0, 200))
const frozenA = cw.clock.now()
await new Promise((r) => setTimeout(r, 40))
check('frozen 时世界时钟停走', Math.abs(cw.clock.now() - frozenA) < 2, `delta=${cw.clock.now() - frozenA}`)
out = await runCommand(cw, cn.id, 'TimeAbility', 'freeze', { Frozen: false })
check('TimeAbility.freeze 解冻', !out.Err && out.Value.frozen === false, JSON.stringify(out).slice(0, 200))
const thawed = cw.clock.now()
check('解冻后从冻结时刻继续', thawed >= frozenA, `frozenA=${frozenA} thawed=${thawed}`)
// 世界时间戳真的跟随模拟时钟：推进 1 天后日志 ts 应显著跳前
const beforeLogTs = cw.logs[cw.logs.length - 1].ts
await runCommand(cw, cn.id, 'TimeAbility', 'advance', { Ms: 86400000 })
const afterLogTs = cw.logs[cw.logs.length - 1].ts
check('世界日志 ts 随模拟时钟前进 1 天', afterLogTs - beforeLogTs >= 86400000 - 2000, `delta=${afterLogTs - beforeLogTs}`)
// TimeAbility.get_time = 世界时钟 + 本节点偏移
out = await runCommand(cw, cn.id, 'TimeAbility', 'sync_manual', { Value: '2024-05-01T08:00:00.000Z' })
check('TimeAbility.sync_manual 成功', !out.Err && typeof out.Value.offsetMs === 'number', JSON.stringify(out).slice(0, 200))
out = await runCommand(cw, cn.id, 'TimeAbility', 'get_time', {})
const nodeDrift = Date.parse(out.Value) - Date.parse('2024-05-01T08:00:00.000Z')
check('get_time = 世界时钟 + 节点偏移', Math.abs(nodeDrift) < 5000, `got=${out.Value} drift=${nodeDrift}`)
out = await runCommand(cw, cn.id, 'TimeAbility', 'sync_system', {})
check('TimeAbility.sync_system 复位节点偏移', !out.Err && out.Value.offsetMs === 0, JSON.stringify(out).slice(0, 200))
out = await runCommand(cw, cn.id, 'TimeAbility', 'clock_status', {})
check('clock_status 暴露 offset/推进量/倍率/冻结', out.Value.offsetMs === 3600000 && out.Value.advanceMs === 86406000 && out.Value.scale === 10 && out.Value.frozen === false, JSON.stringify(out).slice(0, 300))
// 序列化→hydrate 后时钟状态不丢
const clockSer = serializeWorld(cw).clock
const cw2 = hydrateWorld(serializeWorld(cw))
check('hydrate 后 offset/推进量/倍率恢复', cw2.clock.offsetMs === clockSer.offsetMs && cw2.clock.advanceMs === clockSer.advanceMs && cw2.clock.scale === clockSer.scale, JSON.stringify(clockSer))

// ════════════════════════════════════════════════════════════
// 27. MQTT retain：订阅后补投；空 payload 清除留存
// ════════════════════════════════════════════════════════════
const rw2 = buildExampleWorld()
const rc = rw2.nodes.find((n) => n.name === 'cloud-ctl')
const re1 = rw2.nodes.find((n) => n.name === 'edge-01')
await runCommand(rw2, re1.id, 'MQTTAbility', 'disconnect', {})
out = await runCommand(rw2, rc.id, 'MQTTAbility', 'publish', { Topic: 'edge/01/status', Payload: 'retained-hello', Qos: 0, Retain: true })
out = await runCommand(rw2, rc.id, 'MQTTAbility', 'retained', {})
check('retain 发布后被 Broker 留存', !out.Err && JSON.stringify(out.Value).includes('retained-hello'), JSON.stringify(out).slice(0, 200))
await runCommand(rw2, re1.id, 'MQTTAbility', 'connect', {})
out = await runCommand(rw2, re1.id, 'MQTTAbility', 'subscribe', { Topic: 'edge/01/status', Qos: 0 })
check('订阅时补投留存消息（retainedDelivered）', !out.Err && out.Value.retainedDelivered === 1, JSON.stringify(out).slice(0, 200))
out = await runCommand(rw2, re1.id, 'MQTTAbility', 'drain', {})
const retainedMsg = (out.Value || []).find((m) => m.payload === 'retained-hello')
check('补投的消息标记 retain=true', !!retainedMsg && retainedMsg.retain === true, JSON.stringify(out).slice(0, 300))
out = await runCommand(rw2, re1.id, 'MQTTAbility', 'subscribe', { Topic: 'edge/01/status', Qos: 1 })
check('同节点重复订阅不重复补投', !out.Err && out.Value.retainedDelivered === 0, JSON.stringify(out).slice(0, 200))
out = await runCommand(rw2, re1.id, 'MQTTAbility', 'drain', {})
await runCommand(rw2, rc.id, 'MQTTAbility', 'publish', { Topic: 'edge/01/status', Payload: '', Qos: 0, Retain: true })
out = await runCommand(rw2, rc.id, 'MQTTAbility', 'retained', {})
check('空 payload 清除留存', !out.Err && out.Value.length === 0, JSON.stringify(out).slice(0, 200))
// 空 payload 的 retain 发布本身也是一条普通消息，先排空再退订
await runCommand(rw2, re1.id, 'MQTTAbility', 'drain', {})
await runCommand(rw2, re1.id, 'MQTTAbility', 'unsubscribe', { Topic: 'edge/01/status' })
await runCommand(rw2, rc.id, 'MQTTAbility', 'publish', { Topic: 'edge/01/status', Payload: 'retained-again', Qos: 0, Retain: true })
await runCommand(rw2, re1.id, 'MQTTAbility', 'subscribe', { Topic: 'edge/01/status', Qos: 0 })
out = await runCommand(rw2, re1.id, 'MQTTAbility', 'drain', { Topic: 'edge/01/status' })
check('退订后重新订阅可再次补投', out.Value.length === 1 && out.Value[0].payload === 'retained-again', JSON.stringify(out).slice(0, 200))
// 重连后仍会补投一次（MQTT 3.1.1：重连等同全新会话）
await runCommand(rw2, re1.id, 'MQTTAbility', 'disconnect', {})
await runCommand(rw2, re1.id, 'MQTTAbility', 'connect', {})
out = await runCommand(rw2, re1.id, 'MQTTAbility', 'drain', {})
check('重连后补投一次留存', out.Value.length === 1 && out.Value[0].payload === 'retained-again' && out.Value[0].retain === true, JSON.stringify(out).slice(0, 300))

// ════════════════════════════════════════════════════════════
// 28. MQTT QoS 0/1/2 投递语义差异（ack 与两阶段去重可观测）
// ════════════════════════════════════════════════════════════
const qw = createWorld()
const qn1 = addNode(qw, 'custom', 'q-pub', 0, 0)
const qn2 = addNode(qw, 'custom', 'q-sub', 10, 0)
attachComponent(qw, qn1.id, 'MQTTAbility')
attachComponent(qw, qn2.id, 'MQTTAbility')
await runCommand(qw, qn1.id, 'MQTTAbility', 'connect', {})
await runCommand(qw, qn2.id, 'MQTTAbility', 'connect', {})
await runCommand(qw, qn2.id, 'MQTTAbility', 'subscribe', { Topic: 'q/+/data', Qos: 0 })
out = await runCommand(qw, qn1.id, 'MQTTAbility', 'publish', { Topic: 'q/a/data', Payload: 'qos0', Qos: 0 })
check('QoS0 publish 直接路由', !out.Err && out.Value.delivered === 1, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'drain', {})
check('QoS0 立即进 inbox、无 inflight', out.Value.length === 1 && out.Value[0].qos === 0, JSON.stringify(out).slice(0, 300))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'inflight', {})
check('QoS0 不产生 inflight', out.Value.length === 0, JSON.stringify(out).slice(0, 200))

await runCommand(qw, qn2.id, 'MQTTAbility', 'subscribe', { Topic: 'q/+/data', Qos: 1 })
out = await runCommand(qw, qn1.id, 'MQTTAbility', 'publish', { Topic: 'q/b/data', Payload: 'qos1', Qos: 1 })
check('QoS1 publish 被路由', !out.Err && out.Value.delivered === 1, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'drain', {})
const q1msg = (out.Value || []).find((m) => m.payload === 'qos1')
check('QoS1 消息带 packetId', !!q1msg && typeof q1msg.packetId === 'number', JSON.stringify(out).slice(0, 300))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'inflight', {})
check('QoS1 登记 await_puback inflight', out.Value.length === 1 && out.Value[0].stage === 'await_puback' && out.Value[0].qos === 1, JSON.stringify(out).slice(0, 300))
const pid1 = out.Value[0].packetId
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'puback', { PacketID: pid1 })
check('QoS1 puback 成功', !out.Err && out.Value.acked === true, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'inflight', {})
check('puback 后 inflight 清空', out.Value.length === 0, JSON.stringify(out).slice(0, 200))
// 至少一次：未 ack 前可重传（重复投递可观测）
out = await runCommand(qw, qn1.id, 'MQTTAbility', 'publish', { Topic: 'q/c/data', Payload: 'qos1-retry', Qos: 1 })
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'inflight', {})
const pidRetry = out.Value[0].packetId
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'redeliver', { PacketID: pidRetry })
check('QoS1 redeliver 允许重复投递', !out.Err && out.Value.duplicate === true, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'drain', {})
const retried = (out.Value || []).filter((m) => m.payload === 'qos1-retry')
check('redeliver 后 inbox 出现两份（至少一次）', retried.length === 2 && retried.every((m) => m.qos === 1), JSON.stringify(out).slice(0, 300))
// 确认掉这一条，保持 inflight 干净，便于后续 QoS2 断言
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'puback', { PacketID: pidRetry })
check('QoS1 补发报文 puback 成功', !out.Err && out.Value.acked === true, JSON.stringify(out).slice(0, 200))

await runCommand(qw, qn2.id, 'MQTTAbility', 'subscribe', { Topic: 'q/+/data', Qos: 2 })
out = await runCommand(qw, qn1.id, 'MQTTAbility', 'publish', { Topic: 'q/d/data', Payload: 'qos2', Qos: 2 })
check('QoS2 publish 被路由', !out.Err && out.Value.delivered === 1, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'drain', {})
check('QoS2 PUBREC 前不进应用 inbox', !(out.Value || []).some((m) => m.payload === 'qos2'), JSON.stringify(out).slice(0, 300))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'inflight', {})
const q2rec = out.Value.find((m) => m.topic === 'q/d/data')
check('QoS2 先登记 await_pubrec', !!q2rec && q2rec.stage === 'await_pubrec', JSON.stringify(out).slice(0, 300))
const pid2 = q2rec.packetId
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'pubrec', { PacketID: pid2 })
check('QoS2 pubrec 后转 await_pubcomp 且交付应用', !out.Err && out.Value.stage === 'await_pubcomp' && out.Value.delivered === true, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'drain', {})
const q2inbox = (out.Value || []).filter((m) => m.payload === 'qos2')
check('QoS2 pubrec 后消息进 inbox', q2inbox.length === 1 && q2inbox[0].stage === 'await_pubcomp', JSON.stringify(out).slice(0, 300))
// 恰好一次：重复 PUBREC 只去重，不重复投递
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'pubrec', { PacketID: pid2 })
check('重复 pubrec 只去重不重投', !out.Err && out.Value.duplicate === true && out.Value.delivered === false, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'drain', {})
check('重复 pubrec 不产生第二条消息', !(out.Value || []).some((m) => m.payload === 'qos2'), JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'pubcomp', { PacketID: pid2 })
check('QoS2 pubcomp 出清 inflight', !out.Err && out.Value.released === true, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'inflight', {})
check('pubcomp 后 inflight 清空', out.Value.length === 0, JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn1.id, 'MQTTAbility', 'publish', { Topic: 'q/e/data', Payload: 'qos2-bad', Qos: 2 })
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'inflight', {})
const pidBad = out.Value.find((m) => m.topic === 'q/e/data').packetId
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'pubcomp', { PacketID: pidBad })
check('跳过 PUBREC 直接 PUBCOMP 被拒绝', !!out.Err && out.Err.includes('PUBREC'), JSON.stringify(out).slice(0, 200))
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'puback', { PacketID: 999999 })
check('未知 packetId 的 puback 报错', !!out.Err && out.Err.includes('not in flight'), JSON.stringify(out).slice(0, 200))
// 有效 QoS = min(发布 QoS, 订阅 QoS)
await runCommand(qw, qn2.id, 'MQTTAbility', 'subscribe', { Topic: 'q/f/data', Qos: 1 })
out = await runCommand(qw, qn1.id, 'MQTTAbility', 'publish', { Topic: 'q/f/data', Payload: 'min', Qos: 2 })
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'inflight', {})
const minRec = out.Value.find((m) => m.topic === 'q/f/data')
check('有效 QoS = min(pub, sub)', !!minRec && minRec.qos === 1 && minRec.stage === 'await_puback', JSON.stringify(out).slice(0, 300))
out = await runCommand(qw, qn1.id, 'MQTTAbility', 'stats', {})
check('Broker stats 记录 QoS/ack/去重/重传计数', out.Value.puback >= 1 && out.Value.pubrec >= 1 && out.Value.pubcomp >= 1 && out.Value.deduped >= 1 && out.Value.redelivered >= 1, JSON.stringify(out).slice(0, 300))
out = await runCommand(qw, qn1.id, 'MQTTAbility', 'publish', { Topic: 'q/g/data', Payload: 'clock-stamp', Qos: 0 })
out = await runCommand(qw, qn2.id, 'MQTTAbility', 'drain', {})
const stamped = (out.Value || []).find((m) => m.payload === 'clock-stamp')
check('MQTT 消息 at 走世界时钟', !!stamped && Math.abs(Date.parse(stamped.at) - qw.clock.now()) < 5000, `at=${stamped?.at} clock=${qw.clock.nowIso()}`)

// ════════════════════════════════════════════════════════════
// 29. FileTransfer / AlgorithmDistribution 受拓扑连通性约束
// ════════════════════════════════════════════════════════════
const tw = createWorld()
const tn1 = addNode(tw, 'edge', 'ft-a', 0, 0)
const tn2 = addNode(tw, 'edge', 'ft-b', 100, 0)
const tn3 = addNode(tw, 'edge', 'ft-c', 200, 0)
tw.links.push({ id: 'l1', source: tn1.id, target: tn2.id })
await runCommand(tw, tn1.id, 'FileTransferAbility', 'set_target', { Address: 'ft-b' })
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'upload', { RemotePath: '/tmp/a.txt', Content: 'hello' })
check('连通时 upload 成功且带跳数', !out.Err && out.Value.hops === 1 && out.Value.path.length === 2, JSON.stringify(out).slice(0, 200))
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'download', { RemotePath: '/tmp/a.txt' })
check('连通时 download 成功', !out.Err && out.Value.content === 'hello' && out.Value.hops === 1, JSON.stringify(out).slice(0, 200))
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'check_link', {})
check('check_link 返回路径', !out.Err && out.Value.connected === true && out.Value.hops === 1, JSON.stringify(out).slice(0, 200))
await runCommand(tw, tn1.id, 'FileTransferAbility', 'set_target', { Address: 'ft-c' })
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'upload', { RemotePath: '/tmp/b.txt', Content: 'x' })
check('不连通时 upload 失败（错误含两端节点名）', !!out.Err && out.Err.includes('no link path') && out.Err.includes('ft-a') && out.Err.includes('ft-c'), JSON.stringify(out).slice(0, 300))
check('不连通时目标 FS 未被写入', !tn3.fs || !('/tmp/b.txt' in tn3.fs), JSON.stringify(Object.keys(tn3.fs || {})))
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'download', { RemotePath: '/tmp/a.txt' })
check('不连通时 download 失败', !!out.Err && out.Err.includes('no link path'), JSON.stringify(out).slice(0, 300))
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'check_link', { Target: 'ft-c' })
check('check_link 不连通报错', !!out.Err && out.Err.includes('no link path'), JSON.stringify(out).slice(0, 200))
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'check_link', { Target: 'no-such-node' })
check('目标不存在报 not found in topology', !!out.Err && out.Err.includes('not found in topology'), JSON.stringify(out).slice(0, 200))
// 多跳可达（ft-a - ft-b - ft-c）
tw.links.push({ id: 'l2', source: tn2.id, target: tn3.id })
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'check_link', {})
check('两跳路径可达（hops=2）', !out.Err && out.Value.hops === 2, JSON.stringify(out).slice(0, 200))
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'upload', { RemotePath: '/tmp/c.txt', Content: 'multi-hop' })
check('多跳 upload 成功并写入目标 FS', !out.Err && out.Value.hops === 2 && tn3.fs['/tmp/c.txt'] === 'multi-hop', JSON.stringify(out).slice(0, 200))
out = await runCommand(tw, tn1.id, 'AlgorithmDistributionAbility', 'register_algorithm', { Name: 'alg-1', Version: 'v1' })
check('注册算法成功', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(tw, tn1.id, 'AlgorithmDistributionAbility', 'distribute', { Algorithm: 'alg-1', Target: 'ft-c' })
check('连通时 distribute 成功', !out.Err && out.Value.hops === 2, JSON.stringify(out).slice(0, 200))
tw.links = tw.links.filter((l) => l.id !== 'l2')
out = await runCommand(tw, tn1.id, 'AlgorithmDistributionAbility', 'distribute', { Algorithm: 'alg-1', Target: 'ft-c' })
check('删链后 distribute 失败', !!out.Err && out.Err.includes('no link path'), JSON.stringify(out).slice(0, 200))
// 传输记录时间戳走世界时钟
tw.links.push({ id: 'l2', source: tn2.id, target: tn3.id })
await runCommand(tw, tn1.id, 'TimeAbility', 'advance', { Ms: 7200000 })
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'upload', { RemotePath: '/tmp/d.txt', Content: 'ts' })
out = await runCommand(tw, tn1.id, 'FileTransferAbility', 'get_transfer', { Id: out.Value.id })
check('传输记录 createdAt 走世界时钟', Math.abs(Date.parse(out.Value.createdAt) - tw.clock.now()) < 5000, `createdAt=${out.Value.createdAt} clock=${tw.clock.nowIso()}`)

// ════════════════════════════════════════════════════════════
// 30. 参数契约对齐（C3）：JS 侧校验与主仓库 Go 实现逐条对齐后的负面用例
//     只覆盖"应被拒绝"的路径；每个错误关键词与 src/core/registry/*.js 文案一致
// ════════════════════════════════════════════════════════════
const pw = createWorld()
const pSensor = addNode(pw, 'sensor', 'c3-sensor', 0, 0)
const pDb = addNode(pw, 'db', 'c3-db', 100, 0)
const pCloud = addNode(pw, 'cloud', 'c3-cloud', 200, 0)
const pEdge = addNode(pw, 'edge', 'c3-edge', 300, 0)

// --- 30.1 TSN：priority/interval/映射/时间门/重复注册/注销 ---
await runCommand(pw, pSensor.id, 'TSNAbility', 'set_interface', { Iface: 'eth0' })
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'register_talker', { StreamId: 's1', Vlan: 10, Priority: 9, Interval: 1000 })
check('TSN priority 9 被拒绝', !!out.Err && out.Err.includes('priority'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'register_talker', { StreamId: 's1', Vlan: 10, Priority: 3, Interval: 0 })
check('TSN interval 0 被拒绝', !!out.Err && out.Err.includes('interval'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'register_talker', { StreamId: 's1', Vlan: 10, Priority: 3 })
check('TSN 缺 Interval 报 missing required', !!out.Err && out.Err.includes('missing required'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'register_talker', { StreamId: 's1', Vlan: 10, Priority: 3, Interval: 1000 })
check('TSN register_talker 成功', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'register_talker', { StreamId: 's1', Vlan: 10, Priority: 3, Interval: 1000 })
check('TSN 重复注册被拒绝', !!out.Err && out.Err.includes('already exists'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'register_listener', { StreamId: 'nope', Priority: 1 })
check('TSN 监听未注册流被拒绝', !!out.Err && out.Err.includes('not registered'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'register_listener', { StreamId: 's1', Priority: 8 })
check('TSN listener priority 8 被拒绝', !!out.Err && out.Err.includes('priority'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'set_priority_map', { Map: { 9: 1 } })
check('TSN priority_map key 越界被拒绝', !!out.Err && out.Err.includes('out of range'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'set_priority_map', { Map: { 0: 8 } })
check('TSN priority_map value 越界被拒绝', !!out.Err && out.Err.includes('out of range'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'set_priority_map', { Map: { 3: 5 } })
check('TSN priority_map 合法值被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'set_time_aware', { Schedule: Array.from({ length: 17 }, () => 'open') })
check('TSN set_time_aware 17 元素被拒绝', !!out.Err && out.Err.includes('1-16'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'set_time_aware', { Schedule: ['open', 'closed'] })
check('TSN set_time_aware 合法数组被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'TSNAbility', 'unregister', { StreamId: 'ghost' })
check('TSN unregister 不存在流被拒绝', !!out.Err && out.Err.includes('not found'), JSON.stringify(out).slice(0, 200))

// --- 30.2 Modbus：quantity 1..125、write values 1..123 ---
out = await runCommand(pw, pSensor.id, 'ModbusAbility', 'read_holding', { Start: 0, Count: 0 })
check('Modbus read Count=0 被拒绝', !!out.Err && out.Err.includes('1-125'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'ModbusAbility', 'read_holding', { Start: 0, Count: 126 })
check('Modbus read Count=126 被拒绝', !!out.Err && out.Err.includes('1-125'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'ModbusAbility', 'read_holding', { Start: 0, Count: 125 })
check('Modbus read Count=125 被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'ModbusAbility', 'write_holding_multi', { Address: 0, Values: [] })
check('Modbus write 空 Values 被拒绝', !!out.Err && out.Err.includes('1-123'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'ModbusAbility', 'write_holding_multi', { Address: 0, Values: Array.from({ length: 124 }, () => 1) })
check('Modbus write 124 值被拒绝', !!out.Err && out.Err.includes('1-123'), JSON.stringify(out).slice(0, 200))

// --- 30.3 Serial：端口/配置/读取长度 ---
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'open', { Port: 'ttyX' })
check('Serial 非法端口名被拒绝', !!out.Err && out.Err.includes('invalid port'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'set_config', { Baud: 12345 })
check('Serial set_config 非法波特率被拒绝', !!out.Err && out.Err.includes('invalid config'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'set_config', { Baud: 115200, DataBits: 8, StopBits: 1, Parity: 'none' })
check('Serial set_config 合法参数被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'open', { Port: '/dev/ttyUSB0' })
check('Serial open 成功', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'open', { Port: '/dev/ttyUSB0' })
check('Serial 重复打开被拒绝', !!out.Err && out.Err.includes('already open'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'read', { Size: 0 })
check('Serial read Size=0 被拒绝', !!out.Err && out.Err.includes('length must be'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'write', { Data: '' })
check('Serial write 空数据报 missing required', !!out.Err && out.Err.includes('missing required'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'close', {})
check('Serial close 成功', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'SerialAbility', 'close', {})
check('Serial 未打开时 close 被拒绝', !!out.Err && out.Err.includes('not open'), JSON.stringify(out).slice(0, 200))

// --- 30.4 MQTT：broker URL、topic 通配符、QoS 范围 ---
out = await runCommand(pw, pSensor.id, 'MQTTAbility', 'set_broker', { URL: 'http://x:1883' })
check('MQTT http scheme 被拒绝', !!out.Err && out.Err.includes('unsupported broker URL'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'MQTTAbility', 'set_broker', { URL: 'tcp://127.0.0.1:1883' })
check('MQTT 回环 broker 被拒绝', !!out.Err && out.Err.includes('unsupported broker URL'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'MQTTAbility', 'set_broker', { URL: 'tcp://broker.local:1883' })
check('MQTT 合法 broker 被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'MQTTAbility', 'connect', {})
check('MQTT connect 成功', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'MQTTAbility', 'publish', { Topic: 'a/#', Payload: 'x', Qos: 0 })
check('MQTT publish 通配符 topic 被拒绝', !!out.Err && out.Err.includes('wildcard'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'MQTTAbility', 'publish', { Topic: 'a/b', Payload: 'x', Qos: 5 })
check('MQTT publish Qos=5 被拒绝', !!out.Err && out.Err.includes('invalid qos'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'MQTTAbility', 'subscribe', { Topic: 'a/+', Qos: 1 })
check('MQTT subscribe 通配符 topic 被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'MQTTAbility', 'set_client_id', { ClientID: '   ' })
check('MQTT 空白 ClientID 被拒绝', !!out.Err && out.Err.includes('client id empty'), JSON.stringify(out).slice(0, 200))

// --- 30.5 Docker / Kubernetes：镜像引用、容器名、副本数、Kind ---
out = await runCommand(pw, pDb.id, 'DockerAbility', 'pull_image', { Image: '' })
check('Docker 空镜像名报 missing required', !!out.Err && out.Err.includes('missing required'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'DockerAbility', 'pull_image', { Image: 'a b' })
check('Docker 非法镜像引用被拒绝', !!out.Err && out.Err.includes('invalid image ref'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'DockerAbility', 'pull_image', { Image: 'nginx:1.27' })
check('Docker 合法镜像被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'DockerAbility', 'create_container', { Name: 'a/b', Image: 'nginx:1.27' })
check('Docker 非法容器名被拒绝', !!out.Err && out.Err.includes('invalid container name'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'KubernetesAbility', 'scale', { Name: 'web', Replicas: -1 })
check('K8s 负副本数被拒绝', !!out.Err && out.Err.includes('non-negative'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'KubernetesAbility', 'list', { Kind: 'a/b' })
check('K8s 非法 Kind 被拒绝', !!out.Err && out.Err.includes('invalid kind'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'KubernetesAbility', 'set_context', { Context: '  ' })
check('K8s 空白 context 被拒绝', !!out.Err && out.Err.includes('context empty'), JSON.stringify(out).slice(0, 200))

// --- 30.6 Role / CloudRole / EdgeRole ---
out = await runCommand(pw, pEdge.id, 'RoleAbility', 'set_role', { Role: 'sensor' })
check('RoleAbility 非法角色被拒绝', !!out.Err && out.Err.includes('role must be'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pCloud.id, 'CloudRoleAbility', 'get_status', {})
check('CloudRole 初始状态为 unknown', !out.Err && out.Value === 'unknown', JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pCloud.id, 'CloudRoleAbility', 'set_status', { Status: 'online' })
check('CloudRole 旧值 online 被拒绝', !!out.Err && out.Err.includes('invalid status'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pCloud.id, 'CloudRoleAbility', 'set_status', { Status: 'OK' })
check('CloudRole OK 归一化为 healthy', !out.Err && out.Value === 'healthy', JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pCloud.id, 'CloudRoleAbility', 'set_controller', { Address: 'https://user@ctrl.local' })
check('CloudRole 带 userinfo 的控制器地址被拒绝', !!out.Err && out.Err.includes('invalid controller url'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'EdgeRoleAbility', 'record_latency', { LatencyMs: -5 })
check('EdgeRole 负延迟被拒绝', !!out.Err && out.Err.includes('non-negative'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'EdgeRoleAbility', 'add_capability', { Name: '  ' })
check('EdgeRole 空白能力名被拒绝', !!out.Err && out.Err.includes('capability must be'), JSON.stringify(out).slice(0, 200))

// --- 30.7 InfluxDBAbility：token 长度 ---
out = await runCommand(pw, pSensor.id, 'InfluxDBAbility', 'set_token', { Token: 'short' })
check('InfluxDB token 过短被拒绝', !!out.Err && out.Err.includes('min 8'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pSensor.id, 'InfluxDBAbility', 'set_token', { Token: '0123456789abcdef' })
check('InfluxDB token 合法长度被接受', !out.Err, JSON.stringify(out).slice(0, 200))

// --- 30.8 KeyringData：TTL 上限 ---
out = await runCommand(pw, pEdge.id, 'KeyringData', 'issue_token', { Subject: 'c3-x', TTL: 31 * 24 * 3600 })
check('Keyring TTL 超过 30 天被拒绝', !!out.Err && out.Err.includes('30 days'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'KeyringData', 'issue_token', { Subject: 'c3-x', TTL: 3600 })
check('Keyring TTL 合法被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'KeyringData', 'set_secret', { Secret: '0123456789abcdef' })
check('Keyring set_secret 合法长度被接受', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'KeyringData', 'set_secret', { Secret: '   short   ' })
check('Keyring set_secret 空白不计入长度', !!out.Err && out.Err.includes('min 16'), JSON.stringify(out).slice(0, 200))

// --- 30.9 FileTransfer：远端路径穿越 / 目标解析 ---
pw.links.push({ id: 'c3-l1', source: pEdge.id, target: pCloud.id })
out = await runCommand(pw, pEdge.id, 'FileTransferAbility', 'set_target', { Address: 'c3-cloud' })
check('FileTransfer set_target 成功', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'FileTransferAbility', 'upload', { RemotePath: 'rel/a.txt', Content: 'x' })
check('FileTransfer 相对路径被拒绝', !!out.Err && out.Err.includes('remote path must be absolute'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'FileTransferAbility', 'upload', { RemotePath: '/a/../b.txt', Content: 'x' })
check('FileTransfer 含 .. 段路径被拒绝', !!out.Err && out.Err.includes('remote path must be absolute'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'FileTransferAbility', 'upload', { RemotePath: '/tmp/c3.txt', Content: 'ok' })
check('FileTransfer 绝对路径 upload 成功', !out.Err && pCloud.fs['/tmp/c3.txt'] === 'ok', JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'FileTransferAbility', 'set_target', { Address: 'no-such' })
check('FileTransfer 未知目标被拒绝', !!out.Err && out.Err.includes('not found in topology'), JSON.stringify(out).slice(0, 200))

// --- 30.10 AlgorithmDistribution：name/version 白名单 ---
out = await runCommand(pw, pEdge.id, 'AlgorithmDistributionAbility', 'register_algorithm', { Name: 'alg-ok' })
check('注册算法缺 Version 报 missing required', !!out.Err && out.Err.includes('missing required'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'AlgorithmDistributionAbility', 'register_algorithm', { Name: 'a/b', Version: 'v1' })
check('注册算法非法 name 被拒绝', !!out.Err && out.Err.includes('invalid algorithm'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'AlgorithmDistributionAbility', 'register_algorithm', { Name: 'alg-ok', Version: 'v1' })
check('注册算法合法被接受', !out.Err, JSON.stringify(out).slice(0, 200))

// --- 30.11 ConfigData：key trim 语义 ---
out = await runCommand(pw, pEdge.id, 'ConfigData', 'set', { Key: ' a.b ', Value: 'v' })
check('ConfigData set 接受带空白 key 并 trim', !out.Err && out.Value === 'v', JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'ConfigData', 'get', { Key: 'a.b' })
check('ConfigData get 用 trim 后的 key 命中', !out.Err && out.Value === 'v', JSON.stringify(out).slice(0, 200))

// --- 30.12 数据库 Data：configure 持久化 + 地址门禁 ---
out = await runCommand(pw, pDb.id, 'MySQLData', 'configure', { Host: 'db.local', Port: 3306, Database: 'appdb', Username: 'app', TLSMode: 'require' })
check('MySQLData configure 成功且配置生效', !out.Err && out.Value.config.host === 'db.local' && out.Value.config.database === 'appdb' && out.Value.config.tlsMode === 'require', JSON.stringify(out).slice(0, 300))
out = await runCommand(pw, pDb.id, 'MySQLData', 'get_config', {})
check('MySQLData get_config 反映 configure 的值', !out.Err && out.Value.host === 'db.local' && out.Value.port === 3306, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'MySQLData', 'configure', { Host: '127.0.0.1', Port: 3306 })
check('MySQLData 回环 host 被拒绝', !!out.Err && out.Err.includes('invalid config'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'MySQLData', 'configure', { Host: 'db.local', Port: 0 })
check('MySQLData Port=0 被拒绝', !!out.Err && out.Err.includes('invalid config'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'MySQLData', 'configure', { Database: 'bad name' })
check('MySQLData 非法 Database 名被拒绝', !!out.Err && out.Err.includes('invalid config'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'MySQLData', 'set_secret', { Secret: 'abc' })
check('MySQLData set_secret 过短被拒绝', !!out.Err && out.Err.includes('min 8'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'RedisData', 'configure', { Addresses: '10.0.0.1:6379,10.0.0.2:6379', DB: 3 })
check('RedisData configure 成功', !out.Err && out.Value.config.db === 3, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'RedisData', 'configure', { Addresses: 'not-a-host' })
check('RedisData 无端口地址被拒绝', !!out.Err && out.Err.includes('invalid config'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'InfluxDBData', 'configure', { Endpoint: 'http://influx.local:8086', Org: 'acme', Bucket: 'metrics' })
check('InfluxDBData configure 成功', !out.Err && out.Value.config.org === 'acme', JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'InfluxDBData', 'configure', { Endpoint: 'ftp://influx.local' })
check('InfluxDBData 非法 scheme 被拒绝', !!out.Err && out.Err.includes('invalid config'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'SQLiteData', 'configure', { Path: '../../etc/x.db', Mode: 'rwc' })
check('SQLiteData 含 .. 段路径被拒绝', !!out.Err && out.Err.includes('invalid config'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pDb.id, 'SQLiteData', 'configure', { Path: '/var/lib/app.db', Mode: 'bogus' })
check('SQLiteData 非法 Mode 被拒绝', !!out.Err && out.Err.includes('invalid config'), JSON.stringify(out).slice(0, 200))

// --- 30.13 NetMap：地址门禁（私网放行、回环/未指定拒绝） ---
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-priv', Address: '10.9.9.9:7000', Role: 'edge' })
check('NetMap 私网地址放行', !out.Err, JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-loop', Address: '127.0.0.1:7000' })
check('NetMap 回环地址被拒绝', !!out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-zero', Address: '0.0.0.0:7000' })
check('NetMap 未指定地址被拒绝', !!out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: ' p-pad ', Address: '10.9.9.10:7000' })
check('NetMap 带空白 peer name 被拒绝', !!out.Err && out.Err.includes('surrounding spaces'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-localhost', Address: 'localhost:7000' })
check('NetMap localhost 地址被拒绝', !!out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-sub-localhost', Address: 'edge.localhost:7000' })
check('NetMap *.localhost 地址被拒绝', !!out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-short', Address: '127.1:7000' })
check('NetMap 歧义短回环 127.1 被拒绝', !!out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-hex', Address: '0x7f.0.0.1:7000' })
check('NetMap 十六进制回环写法被拒绝', !!out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-dec', Address: '2130706433:7000' })
check('NetMap 十进制回环写法被拒绝', !!out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))
out = await runCommand(pw, pEdge.id, 'NetMapAbility', 'register_peer', { Name: 'p-mapped', Address: '[::ffff:127.0.0.1]:7000' })
check('NetMap IPv4-mapped 回环被拒绝', !!out.Err && out.Err.includes('invalid'), JSON.stringify(out).slice(0, 200))

console.log('\n' + (failures === 0 ? '🎉 全部通过' : `❌ ${failures} 个失败`))
process.exit(failures === 0 ? 0 : 1)
