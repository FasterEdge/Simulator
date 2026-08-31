# FasterEdge Simulator

纯前端、零后端、零登录的 **FasterEdge 离线模拟编排与测试工具**。打开页面即进入画布，像网络拓扑工具一样拖入节点、连线，并为每个节点挂载 Data / Ability 组件、执行命令、跑离线测试场景。所有模拟逻辑（世界、Broker、时钟、虚拟文件系统、命令分发）都在浏览器内运行，数据自动保存到 localStorage，支持 JSON 导入导出。

> 与主仓库 [FasterEdge/FasterEdge](https://github.com/FasterEdge/FasterEdge) 的命令模型对齐：
> Atom（节点）→ 挂载 Data（根）与 Ability（枝干）→ `Command(atom, act, args) → CommandOutput{Name, Value, Err}`。

## 快速开始

```bash
cd Simulator
npm install
npm run dev      # http://localhost:5173
```

生产构建：`npm run build`（产物在 `dist/`），预览：`npm run preview`。

## 功能

- **拓扑画布（Vue Flow）**：拖拽模板到画布创建节点，连线构成拓扑，缩放/平移/小地图。模板：标准 Atom、云端、边缘、传感器、数据库、自定义。
- **节点检查器**：改名称/角色/运行状态；挂载或卸载 Data（BaseData、NetMapData、KeyringData、ConfigData、MySQL/PostgreSQL/SQLite/Redis/MongoDB/InfluxDB）与 Ability（Base/Role/Time/NetMap/OneKey/CloudRole/EdgeRole、Cmd/Sh/Bash、ConfigFile/FileTransfer/AlgorithmDistribution、Modbus/Serial/TSN、MQTT/InfluxDB/EKuiper、Docker/Kubernetes）。
- **命令执行**：每个组件带参数表单（字符串/数字/布尔/下拉/JSON），执行后返回 `CommandOutput`，支持参数必填校验、依赖检查、未知命令报错。
- **跨节点消息**：MQTTAbility 通过世界级模拟 Broker 跨节点路由（支持 `+`/`#` 通配符），发布/订阅/排空。
- **命令控制台**：实时记录每次命令执行（时间/节点/组件/结果/错误），可过滤。
- **离线测试**：编写多步骤场景（节点→组件→命令→参数→断言），断言支持期望成功/失败、Value 包含/等于、Err 包含，运行后逐条 PASS/FAIL。内置三个示例场景。
- **持久化**：自动保存到 localStorage；导出/导入 JSON 拓扑，一键载入示例拓扑。

## 目录结构

```
Simulator/
├── index.html / vite.config.js / package.json
└── src/
    ├── main.js / App.vue / styles.css
    ├── store.js                    # 响应式全局状态 + 操作
    ├── components/                 # TopBar / Palette / Canvas / Inspector 等
    └── core/                       # 纯 JS 模拟核心（不依赖 Vue）
        ├── errors.js crypto.js engine.js world.js
        ├── persistence.js testrunner.js
        └── registry/               # 组件注册表：Data + Ability + 模板
```

`src/core/` 是框架无关的模拟引擎，可用 `node smoke.mjs` 脱离浏览器直接跑核心逻辑冒烟测试。

## 模型对照（主仓库）

| FasterEdge（Go） | 本工具 |
| --- | --- |
| Atom | 画布节点（node.data / node.abilities） |
| Data | Data 组件保存状态（config/keys/topology…） |
| Ability | Ability 组件提供命令面，声明 Data 依赖 |
| Command(atom, act, args) | `runCommand(world, nodeId, component, act, args)` |
| CommandOutput{Name, Value, Err} | 相同结构，Err 为错误文本 |
| ErrInvalidArguments / 等 | `invalid(...)` / `unsupported(...)` / 依赖缺失检查 |
| 真实网络/时钟/FS | 世界 Broker、模拟时钟、节点虚拟 FS（`node.fs`） |

## 技术栈

- Vue 3 + Vite 7
- [@vue-flow/core](https://vueflow.dev)（画布/连线/自定义节点）+ background/controls/minimap
- 无其它运行时依赖

## 许可证

MIT（待定）