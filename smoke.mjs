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

console.log('\n' + (failures === 0 ? '🎉 全部通过' : `❌ ${failures} 个失败`))
process.exit(failures === 0 ? 0 : 1)
