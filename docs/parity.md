# Simulator 与主仓库（FasterEdge Go）校验契约对照

本文件记录 `Simulator/`（纯前端 JS 模拟器）与主仓库 `FasterEdge/ability/*.go`、
`FasterEdge/data/*.go` 之间**参数校验**的对应关系，以及刻意保留或无法模拟的残余差异。

**本表与 README 第九节的 233 项 schema 差分是两套正交清单，不要混算**：第九节差分
（`tools/contract/compare.mjs`）比对的是**命令名与参数名**是否逐条对应，回答"两边的
接口面差在哪"；本表比对的是**同一条命令拿到同一个参数值时，校验结论是否一致**，回答
"同样的输入会不会一方收一方拒"。一个命令可以同时出现在两套清单里（例如
`ModbusAbility.read_holding`：本表关注 `quantity` 1..125 是否对齐，第九节关注 Go 侧
叫 `Quantity` 而 Simulator 叫 `Count`），两侧数字不可相加，也不存在"还剩多少差异"的
单一答案。答辩时被问到"到底还剩多少差异"，正确回答是分别引用：命令名/参数名 233 项
（README 第九节），同值校验结论的刻意差异 12 条（本表第三节）。

- 对照基准：主仓库 `ability/address_policy.go`（`CheckAddr` / `CheckHost` 三级策略）、
  各 `*_ability.go` 的 `Command` 分支与 `data/database_data.go` 的 `validate*` 函数。
  本文件只引用 Go 源码与 Simulator 源码作为依据，不引用任何一侧的 README。
- 原则：**凡主仓库拒绝的，Simulator 一律拒绝**；主仓库放行的私网地址，Simulator
  因示例拓扑全在 `10.0.0.0/8` 而放行（见"结构性差异"第 10 条）。
- 回归保障：`smoke.mjs` 第 30 组（"参数契约对齐（C3）"）逐条钉住本表所列校验，
  错误关键词与实现文案一致；新增的保留段/受限广播断言在第 30.14 组。

---

## 一、共享网络地址策略（`src/core/netpolicy.js`）

| 能力 | 主仓库 | Simulator |
| --- | --- | --- |
| IPv4/IPv6 字面量分类 | `CheckAddr` 先 `Unmap()` 再判 `isAlwaysRejectedAddr` | `ipKind()` 先把 `::ffff:127.0.0.1` 归一化为 IPv4 再判类别 |
| 一律拒绝 | 未指定（`0.0.0.0`/`::`）、组播、链路本地（`169.254/16`、`fe80::/10`）、受限广播 `255.255.255.255` | 同（`loopback`/`unspecified`/`multicast`/`linklocal`/`broadcast`） |
| 非公网可路由保留段 | `isSpecialUseAddr`：`100.64/10`、`192.0.0/24`、`192.0.2/24`、`198.18/15`、`198.51.100/24`、`203.0.113/24`、`192.88.99/24`、`240/4`、IPv6 侧 `2001:db8::/32` | 同集合（`ipKind()` 归入 `private`），随 `allowPrivate` 收放 |
| 回环 | 仅 `AddressPolicyAllowLoopback` 等级放行 | 一律拒绝（`allowPrivate` 不影响回环） |
| 私网 | 由调用方显式选等级：`PublicOnly` 拒私网 | **放行**（`allowPrivate: true`），见结构性差异 10 |
| 主机名 | `CheckHost` 拒 `localhost` / `*.localhost`，拒 `isLegacyNumericHost` | `isAcceptableHostname()`：同两条 + 字符集白名单 |
| 主机名字符 | 拒 `< 0x20`、`0x7f`、空格、`/`、`\`、`?`、`#`、`@` | `/^[a-zA-Z0-9._-]+$/`（更严格，白名单等价于上述黑名单） |
| 端口 | `host:port` 两端必须可解析 | `splitHostPort()` 要求端口为 1..65535 纯数字 |

`isLegacyNumericHost` 覆盖的歧义写法（`127.1`、`0x7f.0.0.1`、`2130706433`、
`0177.0.0.1`）在 Windows 与 glibc 上解析结论相反，两侧一律按不可审计地址拒绝。

---

## 二、逐组件补齐清单

### 2.1 基础 / 角色（`src/core/registry/ability-core.js`）

| 组件·命令 | 已补齐校验 | 对端 Go |
| --- | --- | --- |
| `RoleAbility.set_role` | 白名单 `cloud`/`edge`，错误含 `role must be "cloud" or "edge", got "..."` | `validRoles` |
| `CloudRoleAbility` 初始 `status` | `'online'` → `'unknown'` | 零值语义 |
| `CloudRoleAbility.set_status` | 必填 + 归一化 `healthy/ok/up→healthy`、`degraded`、`offline/down→offline`，未知值拒绝 | `normalizeStatus` |
| `CloudRoleAbility.set_controller` | http/https、拒 userinfo、拒回环/歧义主机名 | `isAcceptableControllerURL` |
| `CloudRoleAbility.register_service` | name 1..128 且 trim 等于原文、address ≤512、服务数 ≤512 | 同 |
| `EdgeRoleAbility.set_zone` | 1..64 | 同 |
| `EdgeRoleAbility.add_capability` | 1..128，上限 256（已存在项可更新） | 同 |
| `EdgeRoleAbility.set_capabilities` | 逐项 1..128、总数 ≤256 | 同 |
| `EdgeRoleAbility.record_latency` | 拒负数（`latency must be non-negative`） | 同 |
| `TimeAbility.configure_run` | mode 白名单、`interval ≥ 0`、`monotonic ⇒ interval==0`、`0<interval<1` 拒 | 同 |
| `TimeAbility.sync_net/sync_ntp` | 走 URL/host 策略，拒回环 | 同 |
| `NetMapAbility.register_peer` | name trim 后等于原文、地址走 `validPeerAddress` | 同 |
| `NetMapAbility.unregister/update_peer` | name 非空 | 同 |
| `NetMapAbility.lookup_peer` | name 或 address 至少一个 | 同 |
| `OneKeyAbility.verify_token` | subject/signature 非空显式检查 | 同 |

### 2.2 工业协议（`src/core/registry/ability-industrial.js`）

| 组件·命令 | 已补齐校验 | 对端 Go |
| --- | --- | --- |
| `ModbusAbility.set_endpoint` | `host:port` 或 `/dev/x:baud:8N1` | `isValidModbusEndpoint` |
| `ModbusAbility.read_*`（四个） | 统一走 `readReg`：`quantity` 1..125（`MODBUS_MAX_READ`） | 同 |
| `ModbusAbility.write_holding_multi` | `Values` 1..123（`MODBUS_MAX_WRITE`）、address 非负整数 | 同 |
| `SerialAbility.open` | 端口名（`/dev/tty*` 或 `COM+数字`）、配置整体合法、拒重复打开 | `isValidSerialPort`/`isValidSerialConfig` |
| `SerialAbility.close` | 未打开时报 `not open` | 同 |
| `SerialAbility.write` | 数据非空 | 同 |
| `SerialAbility.read` | `Size` 1..1MiB | `MAX_SERIAL_READ_BYTES` |
| `SerialAbility.set_config` | 波特率白名单 11 档、`dataBits` 5..8、`stopBits` 1..2、`parity` N/O/E，合并后整体校验 | 同 |
| `TSNAbility.set_interface` | 非空 | 同 |
| `TSNAbility.register_talker` | 新增必填 `Interval`、id 非空/不重复、priority 0..7、interval>0 | 同 |
| `TSNAbility.register_listener` | 新增必填 `Priority` 0..7、流需已注册 | 同 |
| `TSNAbility.unregister` | 不存在时拒绝（旧实现静默 `dropped: []`） | 同 |
| `TSNAbility.set_priority_map` | key/value 均 0..7（旧实现只查 value） | 同 |
| `TSNAbility.set_time_aware` | 元素数 1..16 | `GateStates` 1..16 |

### 2.3 外部系统（`src/core/registry/ability-external.js`）

| 组件·命令 | 已补齐校验 | 对端 Go |
| --- | --- | --- |
| `MQTTAbility.set_broker` | scheme 白名单 `tcp/tls/ssl/ws/wss`、拒 userinfo、要求 host:port 可解析、拒回环/歧义主机名；空值单独报 `broker url empty` | `isAcceptableBrokerURL` |
| `MQTTAbility.set_client_id` | trim 后非空（旧实现空串可覆盖默认 id） | 同 |
| `MQTTAbility.subscribe/publish` | topic ≤65535、Qos 0..2 整数；publish 禁 `#`/`+` 通配符 | 同 |
| `InfluxDBAbility.set_endpoint` | URL 校验 | `validateInfluxEndpoint` |
| `InfluxDBAbility.set_token` | ≥8 字节（`secret too short (min 8 bytes)`） | 同 |
| `InfluxDBAbility.set_org/bucket` | `validateName` | 同 |
| `InfluxDBAbility.write` | measurement ≤128 + 字符白名单、fields 1..256 | 同 |
| `InfluxDBAbility.query` | 必填（旧实现可空） | 同 |
| `EKuiperAbility.set_endpoint` | URL 校验 | 同 |
| `EKuiperAbility` stream/rule | name 走 `validIdentifier`、SQL trim 非空 | 同 |
| `DockerAbility.set_endpoint` | `unix://` 或 `tcp/tls://` + 可解析 host | `isValidDockerEndpoint` |
| `DockerAbility.pull_image` | **去掉 `'nginx:latest'` 空串回落**，改走镜像引用白名单 | 同 |
| `DockerAbility.create_container` | name / image 分别白名单 | 同 |
| `DockerAbility` 容器 ID 查找 | 统一走 `findContainer`（id 或 name 白名单后查找） | 同 |
| `KubernetesAbility.set_context` | 非空 | 同 |
| `KubernetesAbility.apply` | 序列化后 ≤1MiB、kind/name 白名单 | 同 |
| `KubernetesAbility.delete/list/get` | Kind（+Name）白名单 | 同 |
| `KubernetesAbility.scale` | Name 白名单 + Replicas ≥0 整数 | 同 |
| `KubernetesAbility.get_logs` | 新增可选 `Tail`（≥0 整数） | 同 |

### 2.4 文件传输 / 算法分发（`src/core/registry/ability-terminal.js`）

| 组件·命令 | 已补齐校验 | 对端 Go |
| --- | --- | --- |
| `FileTransferAbility.set_target` | 必须可解析到拓扑节点 | 同 |
| `FileTransferAbility.upload/download` | remote 路径以 `/` 开头、无 `..` 段、无反斜杠 | 同 |
| `FileTransferAbility.get_transfer/cancel` | id trim 非空 | 同 |
| `AlgorithmDistributionAbility.register_algorithm` | Version 改必填（**去掉 `'v1'` 回落**），name/version 走白名单 | 同 |
| `AlgorithmDistributionAbility.unregister/get_algorithm` | 非空 | 同 |
| `AlgorithmDistributionAbility.distribute` | algorithm/target 必填 | 同 |

### 2.5 Data 层（`src/core/registry/data.js`）

| 组件·命令 | 已补齐校验 | 对端 Go |
| --- | --- | --- |
| `KeyringData.set_secret` | trim 后 ≥16（空白不计入强度） | 同 |
| `KeyringData.issue_token` | `ttl ≤ 30 天`（`ttl exceeds max 30 days`） | `maxTokenTTL` |
| `KeyringData.revoke_token` | subject trim 非空 | 同 |
| `ConfigData` 的 key | **先 trim 再校验字符集**（`" a.b "` 由拒收改为接受并存储为 `a.b`） | `validateKey` |
| 数据库 `set_secret` | 下限 4 → 8，文案改为 `secret too short (min 8 bytes)` | 同 |
| 六个数据库 `configure` | 新增 `validateSQLConfig` / `validateSQLiteConfig` / `validateRedisConfig` / `validateMongoDBConfig` / `validateInfluxDBConfig` | `validate*` |
| 数据库 `configure` 落盘 | **修复键名大小写 bug**（见下） | — |

#### 修复的既有 bug：`configure` 配置从未生效

`dbCommands.configure` 把参数以 **PascalCase arg key**（`Host`/`Port`）写进
`s.config`，而 `initState` 用 **lowerCamelCase 字段名**（`host`/`port`）初始化。
结果是 `s.config` 同时存在 `host:""` 与 `Host:"db.local"`：`validate` 与
`get_config` 读到的永远是初始空值，`configure` 返回成功但配置从未生效，
`status.configured` 也是靠 `s.configured = true` 硬置的。

修复方式：`makeDB` 把内部字段名随 arg 一起下发（`{ ...def, field }`），handler 写
`cfg[arg.field]`。这修复了全部 6 个数据库，且不改 UI/CLI 的 PascalCase 参数名。

---

## 三、结构性差异（无法或不应模拟）

这些差异源于"Simulator 是纯内存前端模拟器"，不是疏漏。逐条记录以便论文说明边界。

1. **`args != nil` 语义无法表达。** Go 用 `args != nil` 区分"零参命令"与"传了空对象"，
   例如 `BaseData.info`/`logo`、各类 `get_*`/`list_*`、数据库 `get_config`/`status`/`snapshot`
   在 Go 侧传参即报 `ErrInvalidArguments`。Simulator 引擎只把校验后的对象交给 handler，
   无法观测"是否传了参数"，故零参命令传空对象不报错。
2. **无 transport 门禁。** Go 侧 MQTT/Serial/Modbus/Docker/EKuiper 在未注入 transport 时
   一律返回 `no transport set: ErrInvalidArguments`（"不假装成功"）。Simulator 是纯内存模拟，
   没有 transport 概念，`connect`/`open` 直接置状态。
3. **TSN 字段集不同。** Go 的 `TSNRegisterTalkerArgs` 含 `MAC`/`DestMAC`/`PayloadLen`/`VLANID`
   并要求 MAC 格式；Simulator 用 `StreamId`/`Vlan`/`Priority`/`Interval`，没有 MAC 字段，
   因此 MAC 格式校验无从体现（priority/interval/唯一性/队列映射已对齐）。
4. **OneKey 时间戳单位。** Go 用 `time.Time`（内部 UnixNano），Simulator 用 unix 毫秒；
   `verify_token` 的 `IssuedAt > now+1min` 时钟偏移窗口两侧都有，但单位不同，
   跨端令牌不可互验。
5. **TimeAbility `sync_manual` 输入格式。** Go 仅接受 `RFC3339Nano`；Simulator 额外接受
   unix 秒（`/^\d+$/`）以便浏览器侧构造。其余差异：Go 有 `maxSyncOffset`
   （网络源偏差超限拒签）与并发同步槽位限制，Simulator 无对应（软件时钟，无真实偏差）。
6. **FileTransfer 无本地路径校验。** Go 对 `localClean` 做 `os.Lstat` 符号链接拒绝、
   单次传输上限 1 GiB（`maxTransferBytes`）、per-call `Target` 覆盖。Simulator 是虚拟 FS，
   无 symlink 概念、无真实文件大小，且 `set_target` 是会话级而非 per-call。
7. **AlgorithmDistribution 无 `SourcePath` 校验。** Go 读本机文件并校验绝对路径；
   Simulator 用 `Payload` 文本字段替代，故无路径穿越面。
8. **Docker 无 DNS 二次校验与并发闸门。** Go 明确注释"存储期不做 DNS 解析"
   （`LookupHost` 挡不住 DNS rebinding），改为拨号期解析；Simulator 完全不拨号，
   故该 TOCTOU 面不存在也无需模拟。端口声明校验亦无对应（无真实端口绑定）。
9. **Kubernetes 无 kubeconfig/namespace/selector。** Go 侧 `set_context` 带 kubeconfig
   路径与 namespace 校验，`get_logs` 有 1MiB 输出截断；Simulator 用进程内对象表模拟。
10. **私网地址放行。** Go 的 `docker`/`influx`/`controller` 走 `AddressPolicyPublicOnly`，
    额外拒绝私网；Simulator 示例拓扑（edge/broker/DB）全在 `10.0.0.0/8`，
    若照搬将无法表达"内网边缘节点"这一核心场景，故统一 `allowPrivate: true`。
    回环/未指定/组播/链路本地两侧一律拒绝——这是 SSRF 的真正种子。
11. **数据库 `configure` 的增量语义。** Go 的 `validateSQLConfig` 要求一次给全量配置
    （`Database`/`Username` 必填、`TLSMode` 非空合法）；Simulator 的 `configure` 是
    "缺省字段沿用上一次值"的增量合并。为两者兼容，Simulator 对 name 类字段采取
    **"非空才校验格式"**：`host`/`port` 仍必须合法（这是真正的攻击面），
    `Database`/`Username`/`TLSMode`/`Org`/`Bucket` 等在非空时校验字符集与白名单。
    这比 Go 宽（Go 拒"部分配置"），但不会漏放非法值。
12. **引擎层 `required` 与 handler 内校验的重叠。** 引擎的 `validateArgs` 先于 handler
    执行，`required: true` 的空串在引擎层就报 `missing required argument`，
    handler 内的 `xxx empty` 分支因此不可达（如 `SerialAbility.write` 的 `data empty`）。
    两处都保留：handler 内检查服务未来直接复用 handler 的调用方。

---

## 四、验证方式

```bash
cd Simulator
node smoke.mjs        # 必须退出码 0、输出 "🎉 全部通过"
```

`smoke.mjs` 第 30 组"参数契约对齐（C3）"共 105 条断言（原 87 条 + 本次新增的 18 条），
全部为负面或"归一化后取值"断言，无 sleep、无 mock、无恒真断言；不修改第 1–29 组
既有断言（第 1–29 组为 127 条，全文合计 232 条）。本次新增的 18 条集中在第 30.14 组：
对齐主仓库 `isAlwaysRejectedAddr` / `specialUseV4Prefixes`，覆盖受限广播
`255.255.255.255` 与 `240/4`、`198.18/15`、`192.0.2/24`、`100.64/10` 等保留段在
放行/收紧两种等级下的判定。

修复的既有 bug：`ipKind()` 曾缺受限广播与保留段分支。`255.255.255.255` 被判为
`public`（退出即放行），而主仓库 `ability/address_policy.go:78-83` 的
`isAlwaysRejectedAddr` 对任何等级都拒——受限广播不是可建连的单播目标，放行只会把
错误推到拨号期。修复方式是在 `ipKind()` 中把 `255.255.255.255` 单列为 `broadcast`
（先于 `private` 判定，收紧等级也不会漏放），并把主仓库 `specialUseV4Prefixes` 的
8 个非公网可路由段归入 `private`，随 `allowPrivate` 收放。
