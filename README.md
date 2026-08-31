<div align="center">
  <h2>🌳 FasterEdge Simulator</h2>
  <h3>纯前端、零后端的 FasterEdge 离线模拟编排与测试工具</h3>
</div>

### 一、项目简介

- FasterEdge Simulator 是 FasterEdge 生态下的**离线模拟编排与测试工具**：打开页面即进入画布，无需登录、没有后端，像网络拓扑工具一样拖入节点、连线，并为每个节点挂载 Data / Ability 组件、执行命令、跑离线测试场景。

- 它与主仓库 [FasterEdge](https://github.com/FasterEdge/FasterEdge) 的命令模型完全对齐：节点即 **Atom**，挂载 Data（根）与 Ability（枝干），所有交互统一走 `Command(node, component, act, args) -> CommandOutput{Name, Value, Err}`。主仓库里你熟悉的每一个组件、每一条命令，在这里都能「假装」跑起来。

- 所有模拟逻辑（世界、MQTT Broker、模拟时钟、虚拟文件系统、命令分发）都在浏览器内运行，数据自动保存到 localStorage，支持 JSON 导入导出，可离线反复编排与测试。

### 二、术语

- **Atom**: 画布上的节点,其上注册的所有 Data 与 Ability 的容器,提供统一生命周期。
- **Data**: 节点上的"根",承载持久化或运行时状态(配置、密钥、拓扑等)。
- **Ability**: 节点上的"枝干",提供命令式 API。
- **Command**: Ability 与 Data 的统一调用接口,`Command(node, component, act, args) -> CommandOutput{Name, Value, Err}`。
- **World**: 模拟器内部的全局世界(节点、连线、日志、Broker、模拟时钟),驱动整个仿真。
- **Transport**: 主仓库中注入到 Ability 内、由用户实现的外部依赖抽象。本工具用世界级模拟 **Broker**(MQTT 跨节点路由)、**节点虚拟 FS** 与**模拟时钟**扮演 Transport,使 FileTransfer / Modbus / Serial / MQTT / InfluxDB 等能力在离线环境同样可用。

### 三、开发模式（快速开始）

```bash
cd Simulator
npm install
npm run dev        # 打开 http://localhost:5173
```

```bash
npm run build      # 生产构建，产物在 dist/
npm run preview    # 预览生产构建
```

打开页面即载入示例拓扑（云端 + 双边缘节点）：左侧拖模板到画布建节点、连线成拓扑；点击节点在右侧挂载组件、执行命令；"✅ 测试"页签编写并运行离线测试场景。

### 四、生态系统

本工具完整复刻了主仓库的组件注册表，全部为离线模拟实现（模拟器内嵌，无需任何外部驱动）。节点模板：标准 Atom / 云端 / 边缘 / 传感器 / 数据库 / 自定义。

#### 已实现 Data 组件

| 名称         | 功能                                            | 关键命令                                                          |
|--------------|-------------------------------------------------|-------------------------------------------------------------------|
| `BaseData`   | 框架元信息(logo、版本)                          | `logo` / `info`                                                   |
| `NetMapData` | 本节点网络拓扑(节点名、网卡、默认出网接口)     | `info` / `set_node_name` / `interfaces` / `set_default_iface`     |
| `KeyringData`| 共享密钥与令牌表                                | `status` / `set_secret` / `rotate` / `issue_token` / `revoke_*`  |
| `ConfigData` | 扁平点号路径 KV 配置                            | `get` / `set` / `delete` / `list` / `snapshot`                    |
| `MySQLData` / `PostgreSQLData` | 关系数据库公开连接参数与独立密码 | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |
| `SQLiteData` | SQLite 文件、模式、WAL、超时与连接池参数 | `configure` / `get_config` / `status` / `snapshot` |
| `RedisData` | Redis 节点列表、DB、TLS、超时、连接池与独立密码 | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |
| `MongoDBData` | MongoDB 节点、认证源、副本集、TLS 与独立密码 | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |
| `InfluxDBData` | InfluxDB Endpoint、Org、Bucket、超时与独立 Token | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |

数据库密码和 Token 仅保存在 Data 的私有内存中，`get_config`、`snapshot` 与导出 JSON 均不会返回明文。配置或密钥每次变化都会递增 `DatabaseStatus.Revision`。

#### 已实现 Ability 组件

| 名称                       | 类别       | 核心能力                                                                                                                |
|----------------------------|------------|-------------------------------------------------------------------------------------------------------------------------|
| `BaseAbility`              | 基础       | `list_data_names` / `list_ability_names`                                                                                 |
| `RoleAbility`              | 基础       | `describe` / `set_role` / `get_role`                                                                                     |
| `TimeAbility`              | 基础       | `sync_manual` / `sync_system` / `sync_net` / `sync_ntp` / `get_time` / `configure_run`                                  |
| `NetMapAbility`            | 基础       | `register_peer` / `unregister_peer` / `update_peer` / `list_peers` / `lookup_peer` / `get_topology`                     |
| `OneKeyAbility`            | 基础       | `issue_token` / `verify_token` / `revoke_token` / `revoke_all` / `list_tokens` / `status` / `rotate` (HMAC-SHA256)     |
| `CloudRoleAbility`         | 基础       | `describe` / `set_controller` / `register_service` / `set_status` / `heartbeat`(依赖 RoleAbility 且 role=cloud)        |
| `EdgeRoleAbility`          | 基础       | `describe` / `set_zone` / `add_capability` / `record_latency` / `get_metrics` / `set_online`(依赖 RoleAbility 且 role=edge) |
| `CmdAbility`               | 终端       | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist` / `clear_finished`(可插拔 allowlist)                     |
| `ShAbility`                | 终端       | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist`(基于 CmdAbility,sh -c 形式)                              |
| `BashAbility`              | 终端       | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist`(基于 ShAbility,bash --noprofile --norc -c 形式)        |
| `ConfigFileAbility`        | 文件/配置  | `set_path` / `load` / `save` / `exists`(基于 ConfigData 的 JSON 持久化)                                                 |
| `FileTransferAbility`      | 文件/配置  | `set_target` / `upload` / `download` / `list` / `get_transfer` / `cancel`(可插拔 Transport)                            |
| `AlgorithmDistributionAbility` | 文件/配置 | `register_algorithm` / `unregister_algorithm` / `distribute` / `list_distributions` / `cancel`(基于 FileTransfer)   |
| `ModbusAbility`            | 工业协议   | `set_endpoint` / `set_unit_id` / `read_holding` / `read_input` / `read_coils` / `read_discrete` / `write_*`(可插拔)   |
| `SerialAbility`            | 工业协议   | `open` / `close` / `read` / `write` / `set_config` / `list_ports`(可插拔 Transport)                                    |
| `TSNAbility`               | 工业协议   | `set_interface` / `register_talker` / `register_listener` / `unregister` / `set_priority_map` / `set_time_aware`     |
| `MQTTAbility`              | 数据交互   | `set_broker` / `connect` / `disconnect` / `publish` / `subscribe` / `drain` / `list_subscriptions`(世界 Broker 跨节点路由,支持 + / #) |
| `InfluxDBAbility`          | 数据交互   | `set_endpoint` / `set_token` / `set_org` / `set_bucket` / `ping` / `write` / `query` / `list_series` / `delete_series` |
| `EKuiperAbility`           | 数据交互   | `set_endpoint` / `create_stream` / `drop_stream` / `create_rule` / `start_rule` / `stop_rule` / `show_rules`         |
| `DockerAbility`            | 容器编排   | `set_endpoint` / `list_containers` / `start/stop/restart/remove` / `pull_image` / `inspect` / `get_logs` / `create` |
| `KubernetesAbility`        | 容器编排   | `set_context` / `apply` / `delete` / `list` / `get` / `scale` / `get_logs`                                            |

所有依赖外部网络/进程的能力(FileTransfer / Modbus / Serial / MQTT / InfluxDB / EKuiper / Docker / Kubernetes)在主仓库中通过 `SetXxxTransport(...)` 注入真实驱动;本工具则以模拟 Transport(世界 Broker、节点虚拟 FS、模拟时钟)离线复刻同一套命令语义,做到"命令即文档"。

#### 跨节点组合示例（离线跑通）

```js
// 1. 云端通过 NetMap 注册对等节点
runCommand(world, cloud.id, 'NetMapAbility', 'register_peer',
  { Name: 'edge-2', Address: '10.0.0.2:7000', Role: 'edge' })

// 2. 云端通过 OneKey 为其签发短期令牌
const tok = (await runCommand(world, cloud.id, 'OneKeyAbility', 'issue_token',
  { Subject: 'edge-2', TTL: 3600 })).Value

// 3. 边缘订阅主题，云端发布，Broker 跨节点路由
await runCommand(world, edge.id, 'MQTTAbility', 'subscribe', { Topic: 'edge/+/status' })
await runCommand(world, cloud.id, 'MQTTAbility', 'publish',
  { Topic: 'edge/2/status', Payload: 'online' })
const inbox = (await runCommand(world, edge.id, 'MQTTAbility', 'drain', {})).Value // 收到 online
```

### 五、设计哲学

- 依赖抽象而不依赖具体(Depend on Abstractions, Not on Concrete Implementations.)——模拟 Transport 与主仓库的注入式 Transport 同构。
- 遵循策略模式(Strategy Pattern)、命令模式(Command Pattern)、组合模式(Composite Pattern)。
- 所有命令参数为严格类型,缺失必填参数、类型不匹配都会返回 `invalid command arguments`。
- 组件依赖(Data 依赖 / Ability 依赖)在命令分发前检查,缺依赖返回明确错误;RoleAbility 为 Cloud/Edge 角色门控提供依据。
- 涉及外部网络的 Ability 默认拒绝 `localhost` / `127.0.0.1` / `0.0.0.0` / `::1`,降低 SSRF 风险(如 TimeAbility、SerialAbility 等)。

### 六、离线测试

右侧"✅ 测试"页签内置多步骤场景：每个步骤指定 节点 → 组件 → 命令 → 参数(JSON) → 断言(期望成功/失败、Value 包含/等于、Err 包含),运行后逐条 PASS/FAIL,并在控制台留下完整命令日志。内置三个示例场景：MQTT 跨节点订阅发布、OneKey 令牌签发校验、ConfigData 读写与 ConfigFile 持久化。

核心引擎为纯 JS 模块(`src/core/`),不依赖 Vue,可脱离浏览器直接测试：

```bash
node smoke.mjs        # 38 项引擎断言（命令分发 / 依赖检查 / 令牌 / MQTT 路由 / 配置持久化 / 测试断言）
```

### 七、测试

```bash
npm run build         # 生产构建通过（Vite 7 + Vue 3 + Vue Flow）
node smoke.mjs        # 核心引擎冒烟测试全部通过
```

当前覆盖：**引擎命令分发、依赖检查、参数校验、OneKey HMAC 令牌、MQTT 跨节点路由、ConfigFile 持久化、角色门控、测试断言等 38 项断言,全部通过;生产构建无错误。**
