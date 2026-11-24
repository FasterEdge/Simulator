<div align="center">
  <img src="https://avatars.githubusercontent.com/u/245985800?s=200&v=4" alt="logo" width="100" />
  <h2>FasterEdge Simulator</h2>
  <h3>纯前端、零后端的 FasterEdge 离线模拟编排与测试工具</h3>
</div>

> **⚠️ 命令模型声明**
>
> 本工具的画布命令模型是 **Atom / Ability**，属于 FasterEdge 框架早期的模拟器。
> 毕业设计课题采用的模型是 **Node / Component**（节点为最大编排颗粒，节点之上是
> 能力组件，形态含 binary / container / kernel-module / driver / archive），
> 其可视化编排实现见
> [AIOperations/web](https://github.com/FasterEdge/AIOperations/tree/main/web)。
>
> **两者不是同一套体系**：本仓库的命令模型与课题采用的 Node/Component 模型不通用，
> 本仓库的编排结果不构成课题成果。保留本仓库是为兼容早期实验数据。

### 一、项目简介

- FasterEdge Simulator 是 FasterEdge 生态下的**离线模拟编排与测试工具**：打开页面即进入画布，无需登录、没有后端，像网络拓扑工具一样拖入节点、连线，并为每个节点挂载 Data / Ability 组件、执行命令、跑离线测试场景。

- 它与主仓库 [FasterEdge](https://github.com/FasterEdge/FasterEdge) 共用同一套命令模型：节点即 **Atom**，挂载 Data（根）与 Ability（枝干），所有交互统一走 `Command(node, component, act, args) -> CommandOutput{Name, Value, Err}`。**对齐程度有机器可核验的边界**：组件名与命令名已全部对齐（主仓库 Go 侧 31 组件 / 226 条命令，`missingCommand` 为 0），但**参数 schema 尚未对齐**——主仓库的 210 条参数名/参数集差异、17 条模拟器特有命令、6 条嵌套参数结构体差异，逐条记录在第九节的契约差分里；不要读成"参数也一一对应"。
  两侧口径不同，读数字时请分开：**主仓库 Go 侧 31 组件 / 226 条命令**（`contract.json`），**Simulator registry 侧 31 组件 / 243 条命令**（`src/core/registry/*.js` 的 `commands` 导出，`node tools/contract/compare.mjs` 读的就是它）。多出的 17 条即第九节 `extraCommand`：模拟器为世界时钟（`TimeAbility.set_offset/advance/set_scale/freeze/clock_status`）、MQTT QoS/retain 观测（`puback/pubrec/pubcomp/redeliver/inflight/retained/stats`）、拓扑连通探测（`FileTransferAbility.check_link`）以及 Sh/Bash 的 `get_job`/`clear_finished` 额外提供的命令。226 + 17 = 243 可逐条对上。

- 所有模拟逻辑（世界、MQTT Broker、模拟时钟、虚拟文件系统、命令分发）都在浏览器内运行，数据自动保存到 localStorage，支持 JSON 导入导出，可离线反复编排与测试。

#### 目录树与新增文件职责

```
Simulator/
├── index.html                Vite 入口 HTML
├── vite.config.js            Vite 配置（Vue 插件 + dev server 端口 5173）
├── package.json / package-lock.json   依赖与脚本（npm run test / build）
├── smoke.mjs                 引擎冒烟断言（232 项，不依赖 DOM）
├── contract.json             从主仓库 Go 源码静态提取的命令契约（31 组件 / 226 命令）
├── contract-baseline.json    契约差分基线（233 项，由 node --test 守护）
├── src/
│   ├── main.js / App.vue / store.js / styles.css   Vue 应用外壳与全局状态
│   ├── components/           画布、节点、右侧检查器、测试页签等 8 个 Vue 组件
│   └── core/
│       ├── engine.js         Command(node, component, act, args) 分发 + 参数校验
│       ├── world.js          世界状态（节点/连线/日志/Broker/时钟），Vue reactive 容器
│       ├── registry/         31 个 Data/Ability 组件的 commands 导出与 handler
│       ├── clock.js          模拟时钟（advance / set_scale / freeze / offset）
│       ├── netpolicy.js      网络地址策略分级判定（对齐主仓库 address_policy.go）
│       ├── trace.js          命令 trace 录制/回放 + 确定性环境（withDeterminism）
│       ├── testrunner.js     场景 DSL（多步骤断言）与内置示例场景
│       ├── persistence.js    世界序列化 / 反序列化与示例拓扑构建
│       ├── crypto.js         HMAC-SHA256 / SHA-256 封装（OneKey / Keyring 用）
│       └── errors.js         统一错误构造（invalid command arguments 等）
├── test/                     node:test 断言（契约差分守门 + trace 回放，共 23 项）
├── tools/contract/compare.mjs  契约比对器（registry ↔ contract.json schema 级差分）
├── scripts/trace.mjs         trace CLI（record / replay / selftest）
└── docs/parity.md            参数校验逐组件对照表 + 结构性差异清单
```

本次工作中新增/补齐的 8 个文件，职责如下：

| 文件 | 职责 | 被谁守护 |
|---|---|---|
| `src/core/netpolicy.js` | 全仓库唯一的地址判定入口：IP 字面量分类、`isDialableHost`（按等级）、`splitHostPort`、`isAcceptableHostname`（回环别名 + 歧义数字主机名） | `smoke.mjs` 第 30.14 组 |
| `src/core/clock.js` | 模拟时钟：把系统时间线性映射为可推进/快进/冻结的模拟时间，`TimeAbility` 与所有引擎时间戳读它 | `smoke.mjs` 时钟组 + `test/trace.test.mjs` |
| `src/core/trace.js` | 命令执行 trace 的录制/回放与确定性环境：固定时钟 + 种子化 `getRandomValues`，命令处理器真实执行不做 mock | `test/trace.test.mjs` 23 项 |
| `scripts/trace.mjs` | trace CLI：`record` / `replay` / `selftest` 三个子命令，退出码 1 表示回放不一致 | `.github/workflows/test.yml` 端到端步 |
| `tools/contract/compare.mjs` | 契约比对器：读 registry 真实导出与 `contract.json` 做 schema 级差分，输出五类差异与计数 | `test/contract.test.mjs` |
| `contract.json` | 主仓库 Go 源码静态提取结果（`cmd/contract`），含组件/命令/参数 json tag/三态必填 | `test/contract.test.mjs` |
| `contract-baseline.json` | 差分基线：`byKind` 计数与 `total`，任何一侧增删命令/参数都会让 `node --test` 变红 | `test/contract.test.mjs` |
| `docs/parity.md` | 参数校验逐组件对照表 + 12 条结构性差异，说明"哪些是刻意不一致" | 人工维护，与 `smoke.mjs` 第 30 组关键词一致 |

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

本工具实现了与主仓库同名的组件注册表，全部为离线模拟实现（模拟器内嵌，无需任何外部驱动）。节点模板：标准 Atom / 云端 / 边缘 / 传感器 / 数据库 / 自定义。**"已实现"指命令名已在注册表中可调，不等于参数 schema 与主仓库一致**（见第九节契约差分）。

#### 已实现 Data 组件

| 名称         | 功能                                            | 关键命令                                                          |
|--------------|-------------------------------------------------|-------------------------------------------------------------------|
| `BaseData`   | 框架元信息(logo、版本)                          | `logo` / `info`                                                   |
| `NetMapData` | 本节点网络拓扑(节点名、网卡、默认出网接口)     | `info` / `set_node_name` / `interfaces` / `set_default_iface`     |
| `KeyringData`| 共享密钥与令牌表                                | `status` / `set_secret` / `rotate` / `issue_token` / `list_tokens` / `revoke_token` / `revoke_all` |
| `ConfigData` | 扁平点号路径 KV 配置                            | `get` / `set` / `delete` / `list` / `snapshot`                    |
| `MySQLData` / `PostgreSQLData` | 关系数据库公开连接参数与独立密码 | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` || `SQLiteData` | SQLite 文件、模式、WAL、超时与连接池参数 | `configure` / `get_config` / `status` / `snapshot` |
| `RedisData` | Redis 节点列表、DB、TLS、超时、连接池与独立密码 | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |
| `MongoDBData` | MongoDB 节点、认证源、副本集、TLS 与独立密码 | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |
| `InfluxDBData` | InfluxDB Endpoint、Org、Bucket、超时与独立 Token | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |

数据库密码和 Token 仅保存在 Data 的私有内存中，`get_config`、`snapshot` 与导出 JSON 均不会返回明文。配置或密钥每次变化都会递增 `DatabaseStatus.Revision`。

#### 已实现 Ability 组件

下表命令名逐条取自 `src/core/registry/*.js` 的 `commands` 导出（31 组件 / 243 条命令，与第九节 `node tools/contract/compare.mjs` 读的是同一份对象）；机器可核验的版本是第九节差分，本表只做人读摘要。

| 名称                       | 类别       | 核心能力                                                                                                                |
|----------------------------|------------|-------------------------------------------------------------------------------------------------------------------------|
| `BaseAbility`              | 基础       | `list_data_names` / `list_ability_names`                                                                                 |
| `RoleAbility`              | 基础       | `describe` / `set_role` / `get_role`                                                                                     |
| `TimeAbility`              | 基础       | `sync_manual` / `sync_system` / `sync_net` / `sync_ntp` / `get_time` / `last` / `set_offset` / `advance` / `set_scale` / `freeze` / `clock_status` / `configure_run` |
| `NetMapAbility`            | 基础       | `register_peer` / `unregister_peer` / `update_peer` / `list_peers` / `lookup_peer` / `get_topology`                     |
| `OneKeyAbility`            | 基础       | `issue_token` / `verify_token` / `revoke_token` / `revoke_all` / `list_tokens` / `status` / `rotate` (HMAC-SHA256)     |
| `CloudRoleAbility`         | 基础       | `describe` / `set_controller` / `get_controller` / `register_service` / `unregister_service` / `list_services` / `set_status` / `get_status` / `heartbeat`(全部命令要求 role=cloud) |
| `EdgeRoleAbility`          | 基础       | `describe` / `set_zone` / `get_zone` / `add_capability` / `remove_capability` / `list_capabilities` / `set_capabilities` / `record_latency` / `get_metrics` / `set_online`(全部命令要求 role=edge) |
| `CmdAbility`               | 终端       | `run` / `start` / `wait` / `kill` / `list` / `get_job` / `clear_finished` / `set_allowlist` / `get_allowlist` / `set_allowlist_any`(allowlist 空表=拒绝一切,默认含常用命令;`set_allowlist_any` 是唯一 opt-in 全放行入口) |
| `ShAbility`                | 终端       | `run` / `start` / `wait` / `kill` / `list` / `get_job` / `clear_finished` / `set_allowlist` / `get_allowlist` / `set_allowlist_any`(基于 CmdAbility,sh -c 形式) |
| `BashAbility`              | 终端       | `run` / `start` / `wait` / `kill` / `list` / `get_job` / `clear_finished` / `set_allowlist` / `get_allowlist` / `set_allowlist_any`(基于 ShAbility,bash --noprofile --norc -c 形式) |
| `ConfigFileAbility`        | 文件/配置  | `set_path` / `get_path` / `load` / `save` / `exists`(基于 ConfigData 的 JSON 持久化)                                    |
| `FileTransferAbility`      | 文件/配置  | `set_target` / `get_target` / `upload` / `download` / `check_link` / `list` / `get_transfer` / `clear_finished` / `cancel`(可插拔 Transport,受拓扑连通约束) |
| `AlgorithmDistributionAbility` | 文件/配置 | `register_algorithm` / `unregister_algorithm` / `get_algorithm` / `list_algorithms` / `distribute` / `list_distributions` / `clear_finished` / `cancel`(基于 FileTransfer) |
| `ModbusAbility`            | 工业协议   | `set_endpoint` / `get_endpoint` / `set_unit_id` / `get_unit_id` / `read_holding` / `read_input` / `read_coils` / `read_discrete` / `write_coil` / `write_holding` / `write_holding_multi`(可插拔) |
| `SerialAbility`            | 工业协议   | `open` / `is_open` / `close` / `read` / `write` / `set_config` / `get_config` / `list_ports`(可插拔 Transport)            |
| `TSNAbility`               | 工业协议   | `set_interface` / `get_interface` / `register_talker` / `register_listener` / `unregister` / `list_streams` / `set_priority_map` / `get_priority_map` / `set_time_aware` / `get_time_aware` |
| `MQTTAbility`              | 数据交互   | `set_broker` / `get_broker` / `set_client_id` / `set_credentials` / `connect` / `is_connected` / `disconnect` / `subscribe` / `unsubscribe` / `list_subscriptions` / `publish` / `drain` / `puback` / `pubrec` / `pubcomp` / `redeliver` / `inflight` / `retained` / `stats`(世界 Broker 跨节点路由,支持 + / # / retain / QoS 0/1/2) |
| `InfluxDBAbility`          | 数据交互   | `set_endpoint` / `get_endpoint` / `set_token` / `set_org` / `set_bucket` / `get_config` / `ping` / `write` / `query` / `list_series` / `delete_series` |
| `EKuiperAbility`           | 数据交互   | `set_endpoint` / `get_endpoint` / `create_stream` / `get_stream` / `list_streams` / `drop_stream` / `create_rule` / `get_rule_status` / `drop_rule` / `start_rule` / `stop_rule` / `show_rules` |
| `DockerAbility`            | 容器编排   | `set_endpoint` / `get_endpoint` / `list_containers` / `create_container` / `start_container` / `stop_container` / `restart_container` / `remove_container` / `inspect_container` / `pull_image` / `get_logs` |
| `KubernetesAbility`        | 容器编排   | `set_context` / `get_context` / `apply` / `delete` / `list` / `get` / `scale` / `get_logs`                                |

关于 Cmd/Sh/Bash 的作业命令有一条**实测口径**：三者的 `commands` 导出完全一致，都是 `run`/`start`/`wait`/`kill`/`list`/`get_job`/`clear_finished`/`set_allowlist`/`get_allowlist`/`set_allowlist_any`（`node smoke.mjs` 与 `src/core/registry/ability-terminal.js` 的 `makeCmdAbility` 可复现，三者共用同一份命令表）。它们在第九节仍被逐条计入 `extraCommand`，是因为**主仓库**只把 `clear_finished`/`get_job` 挂在 CmdAbility 上——`ability/bash_ability.go:195` 的注释明确写着"祖先组件目录中不被本组件转发的 act(get_job / clear_finished) 一概不出现"，即 Go 侧 Sh/Bash 只透传 `wait`/`kill`/`list`。这是"模拟器超出主仓库"的部分，README 如实标注，不伪装成主仓库命令。

所有依赖外部网络/进程的能力(FileTransfer / Modbus / Serial / MQTT / InfluxDB / EKuiper / Docker / Kubernetes)在主仓库中通过 `SetXxxTransport(...)` 注入真实驱动;本工具则以模拟 Transport(世界 Broker、节点虚拟 FS、模拟时钟)离线复刻同一套命令语义,做到"命令即文档"。

模拟 Transport 的三条语义边界(与主仓库真实驱动的差异,均可用 `node smoke.mjs` 复现):

- **模拟时钟**:`world.clockOffsetMs` 是世界时钟相对系统时间的整体偏移,由 `src/core/clock.js` 承载,引擎内全部时间戳(日志、传输记录、Broker 投递时刻)都读它;`TimeAbility.advance` 手动推进、`set_scale` 快进倍率、`freeze` 冻结/解冻,`clock_status` 读回状态,序列化/反序列化后状态不丢。
- **MQTT 投递语义**:有效 QoS = `min(发布 QoS, 订阅 QoS)`,同一主题命中多条订阅时取最具体的过滤器;`Retain=true` 留存最新一条并在订阅/重连时补投,空 payload 清除留存;QoS 1 至少一次(可 `puback` 确认、未确认前可 `redeliver` 重传,重复投递可观测),QoS 2 恰好一次(`pubrec` 两阶段:PUBREC 后才交给应用,重复 PUBREC 只去重不重投,`pubcomp` 出清)。
- **拓扑连通**:`FileTransferAbility` 与 `AlgorithmDistributionAbility` 在 `world.links` 上做 BFS,不连通即失败并给出 `no link path from "A" to "B" in topology`,`check_link` 可单独探测路径与跳数。

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
- 涉及外部网络的 Ability 默认拒绝 `localhost` / `127.0.0.1` / `0.0.0.0` / `::1`,降低 SSRF 风险(如 TimeAbility、MQTTAbility、NetMapAbility 等)。

#### 地址策略分级

`src/core/netpolicy.js` 是模拟器侧**唯一**的地址判定入口（`ability-core.js` / `ability-external.js` / `ability-industrial.js` / `data.js` 都从它 import），对齐主仓库 `ability/address_policy.go` 的 `CheckAddr` / `CheckHost`。主仓库由调用方显式选等级，模拟器统一取 `allowPrivate: true`：

| 地址类别 | 主仓库（任何等级） | 主仓库 `AddressPolicyPublicOnly` | 主仓库 `AllowPrivate` / `AllowLoopback` | Simulator（`allowPrivate: true`） |
|---|---|---|---|---|
| 回环 `127/8`、`::1` | 拒 | 拒 | `AllowLoopback` 起放行 | 拒（见 `docs/parity.md` 结构性差异） |
| 未指定 `0.0.0.0`、`::` | 拒 | 拒 | 拒 | 拒 |
| 组播 `224/4`、`ff00::/8` | 拒 | 拒 | 拒 | 拒 |
| 链路本地 `169.254/16`、`fe80::/10` | 拒 | 拒 | 拒 | 拒 |
| **受限广播 `255.255.255.255/32`** | **拒** | 拒 | 拒 | **拒** |
| RFC1918 `10/8`、`172.16/12`、`192.168/16`、ULA `fc00::/7` | 放行 | 拒 | 放行 | 放行 |
| 文档保留段 `192.0.2/24`、`198.51.100/24`、`203.0.113/24`、`198.18/15`、`100.64/10`、`192.0.0/24`、`192.88.99/24`、`240/4` | 放行 | 拒 | 放行 | 放行 |
| 公网可路由 | 放行 | 放行 | 放行 | 放行 |

三条要点：

- **受限广播不是私网**。`255.255.255.255` 在主仓库走 `isAlwaysRejectedAddr`（`ability/address_policy.go:78-83`），任何等级都拒；模拟器在 `ipKind()` 里单列 `broadcast` 分支，先于 `private` 判定，收紧等级也不会漏放。
- **`localhost` / `*.localhost` 别名与歧义数字主机名**（`127.1`、`0x7f.0.0.1`、`2130706433`、`0177.0.0.1`）在两侧一律拒绝——这些写法在 Windows 与 glibc 上解析结论相反，按不可审计地址处理。
- **收紧路径可用**：`isDialableHost(host, { allowPrivate: false })` 即 `AddressPolicyPublicOnly` 的等价实现，`node smoke.mjs` 第 30.14 组对 `255.255.255.255` / `240.0.0.1` / `198.18.0.1` / `198.19.255.255` / `192.0.2.5` / `100.64.0.1` 逐一断言"收紧即拒"。

### 六、离线测试

右侧"✅ 测试"页签内置多步骤场景：每个步骤指定 节点 → 组件 → 命令 → 参数(JSON) → 断言(期望成功/失败、Value 包含/等于、Err 包含),运行后逐条 PASS/FAIL,并在控制台留下完整命令日志。内置三个示例场景：MQTT 跨节点订阅发布、OneKey 令牌签发校验、ConfigData 读写与 ConfigFile 持久化。

核心引擎为纯 JS 模块(`src/core/`),可脱离浏览器直接测试；引擎内只有 `src/core/world.js:6` 的 `import { reactive, markRaw } from 'vue'` 依赖 Vue(世界状态用 Vue 的响应式容器承载,让画布自动重绘),其余模块(engine / registry / trace / testrunner / clock / netpolicy / persistence)均为零依赖纯 JS：

```bash
npm run test          # 一键跑：smoke.mjs（232 项）+ test/（23 项 node:test 断言）
node smoke.mjs        # 232 项引擎断言（命令分发 / 依赖检查 / 令牌 / MQTT 路由与 retain/QoS / 模拟时钟 / 拓扑连通 / 配置持久化 / 测试断言 / 序列化往返 / 地址策略分级）
node --test           # 23 项 trace 录制回放与序列化往返断言
```

### 七、命令 trace 录制与回放

除场景 DSL 的"单条命令断言"外,`src/core/trace.js` 提供**命令执行 trace 的录制与回放**：把一段命令序列真实执行一遍,连每条的 `CommandOutput`、命令日志与执行后的世界终态一起写进 JSON；回放时从 trace 内的初始世界重建,按同样顺序重新执行,逐条比对输出/日志并比对终态。

回放可复现的前提是"外部输入"被钉死,因此录制与回放在**确定性环境**里执行(`withDeterminism`)：固定模拟时钟 + 固定随机源(种子化 `getRandomValues`),命令处理器本身照常真实执行,不做任何 mock。

```bash
# 录制示例场景到 JSON
node scripts/trace.mjs record --scenario 0 --out trace-mqtt.json
# 回放并与录制结果比对（不一致时退出码 1 并打印差异路径）
node scripts/trace.mjs replay trace-mqtt.json
# 录制→JSON→回放 端到端自检
node scripts/trace.mjs selftest --scenario 1
```

回放差异定位到具体路径,例如 `[step#0] out.Value.connected: 期望 false 实际 true`,而不是只报"不相等"。

### 八、测试

```bash
npm run test          # 离线测试全绿（smoke.mjs + node --test）
npm run build         # 生产构建通过（Vite 8 + Vue 3 + Vue Flow）
```

当前覆盖：**引擎命令分发、依赖检查、参数校验、OneKey HMAC 令牌、MQTT 跨节点路由(含 retain 补投 / QoS 0/1/2 两阶段 ack 与去重)、模拟时钟推进与快进、FileTransfer 拓扑连通约束、ConfigFile 持久化、角色门控、测试断言、序列化/反序列化往返、地址策略分级(受限广播与文档保留段)等 232 项断言；外加 23 项 trace 录制回放与状态往返断言(录制→JSON→回放后命令日志与终态逐字节一致、篡改必被发现、links/Broker 运行时状态/时钟快照往返等价),全部通过;生产构建无错误。** CI 见 `.github/workflows/test.yml`。

### 九、与主仓库的命令契约比对

README 表格里的"命令清单"是手写的，会与主仓库 `FasterEdge` 的 Go 源码漂移——为此引入**契约提取 + 差分**，用机器代替人眼对齐：

```bash
# 1. 在主仓库从 Go 源码静态提取命令契约（组件/命令/参数结构体/必填）
cd ../FasterEdge && go run ./cmd/contract -out contract/contract.json

# 2. 把契约与本仓库 src/core/registry/*.js 的实际分派做 schema 级差分
cd ../Simulator && node tools/contract/compare.mjs [contract.json] [--verbose] [--strict]
```

提取器读的是 `ability/` 与 `data/` 里每个组件 `Command()` 的 `switch act` 分支与 `args.(XxxArgs)` 类型断言（含经 helper 委托的链路，如 `simpleContainerAction` / `sqlCommand`），输出字段含 json tag、Go 类型与三态必填（`required` = 分派分支显式拒绝空值 / `optional` = `omitempty` 或注释注明可选 / `unknown` = 静态无法判定，`unknown` 不参与必填判定）。

比对器输出五类差异：`missingCommand`（Go 有、Simulator 无）、`extraCommand`（Simulator 发明）、`argNameDiff`（参数名不一致）、`requiredDiff`（必填不一致）、`shapeDiff`（Go 嵌套参数结构体而 Simulator 用扁平参数）。差异基线记录在 `contract-baseline.json`，由 `node --test` 守护：**任何一侧新增/删除命令或参数都会让测试变红**，必须先看 diff 再决定补齐代码还是更新基线，不允许无声漂移。

当前基线（`contract.json` @ schemaVersion 1）：Go 侧 31 个组件 / 226 条命令 / 198 个命令常量；差异 233 项 = `missingCommand` 0 + `extraCommand` 17 + `argNameDiff` 210 + `requiredDiff` 0 + `shapeDiff` 6。同一份 registry 在 Simulator 侧是 31 组件 / 243 条命令，226 + 17 = 243 与 `extraCommand` 逐条对上。

这 233 项是**真实的已知不一致**，分两类，都还没有修：

- `extraCommand`（17 项）：模拟器为世界时钟（`TimeAbility.set_offset/advance/set_scale/freeze/clock_status`）、MQTT QoS/retain 观测（`puback/pubrec/pubcomp/redeliver/inflight/retained/stats`）、拓扑连通探测（`FileTransferAbility.check_link`）以及 Cmd/Sh/Bash 的 `get_job`/`clear_finished` 额外提供的命令。这些是**模拟器超出主仓库的部分**，README 已如实标注为"模拟 Transport 的语义边界"，不伪装成主仓库命令。
  其中 `get_job`/`clear_finished` 的差异是**暴露面**而非实现差异：模拟器三者共用同一份命令表（`src/core/registry/ability-terminal.js` 的 `makeCmdAbility`），而主仓库 `ability/sh_ability.go` 第 365-374 行的 `shAbilityCommands` 与 `ability/bash_ability.go` 第 197-206 行的 `bashAbilityCommands` 都**只转发 `wait`/`kill`/`list`**，注释明确写着"CmdAbility 的 get_job / clear_finished 没有被转发——因此 ListCommands 不得包含这两个父命令。谎报会让 Atom.CommandNames 导出一份调不通的命令目录"。所以 Simulator 侧这三个组件都比 Go 多两个可调命令，这不是主仓库有而 Simulator 漏（`missingCommand` 为 0），方向相反。
- `argNameDiff`（210 项）：主仓库的参数名与模拟器不同（主仓库 `IDOrName/JobID/Address/Quantity`，模拟器 `Id/Start/Count`），或主仓库支持而模拟器未暴露的参数（`Timeout/Env/Scope/Nonce` 等）。**这是尚未兑现的"命令模型完全对齐"**：目前只做到"命令名对齐"，参数 schema 并未对齐。

`requiredDiff` 为 0 是因为主仓库几乎不给必填元数据（Go 端没有 tag 描述必填），静态只能识别 10 处显式空值拒绝；这条指标的可信度受此限制，不应当成"参数校验已等价"的证据。
