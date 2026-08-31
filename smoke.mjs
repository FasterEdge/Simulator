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

console.log('\n' + (failures === 0 ? '🎉 全部通过' : `❌ ${failures} 个失败`))
process.exit(failures === 0 ? 0 : 1)
