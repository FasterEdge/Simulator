<div align="center">
  <img src="https://avatars.githubusercontent.com/u/245985800?s=200&v=4" alt="logo" width="100" />
  <h2>FasterEdge Simulator</h2>
  <h3>A Frontend-Only, Backend-Free Offline Orchestration and Testing Tool for FasterEdge</h3>
</div>

### 1. Introduction

- FasterEdge Simulator is an **offline simulation, orchestration, and testing tool** in the FasterEdge ecosystem. Opening the page takes you directly to a canvas with no login or backend. Like a network-topology tool, it lets you drag in nodes, connect them, mount Data / Ability components on each node, execute commands, and run offline test scenarios.
- It follows the command model of the main [FasterEdge](https://github.com/FasterEdge/FasterEdge) repository: a node is an **Atom**, Data components are its roots, and Ability components are its branches. All interactions use `Command(node, component, act, args) -> CommandOutput{Name, Value, Err}`. Components and commands from the main repository can be simulated here.
- All simulation logic—including the world, MQTT broker, simulated clock, virtual file systems, and command dispatch—runs in the browser. Data is automatically saved to `localStorage`, and JSON import and export support repeated offline orchestration and testing.

### 2. Terminology

- **Atom**: a node on the canvas and the container for all Data and Ability components registered on that node, with a unified lifecycle.
- **Data**: the "root" on a node, carrying persistent or runtime state such as configuration, secrets, and topology.
- **Ability**: the "branch" on a node, providing imperative APIs.
- **Command**: the unified invocation interface for Ability and Data: `Command(node, component, act, args) -> CommandOutput{Name, Value, Err}`.
- **World**: the simulator's global world containing nodes, links, logs, the broker, and the simulated clock; it drives the simulation.
- **Transport**: the external dependency abstraction injected into Ability components and implemented by users in the main repository. This tool substitutes world-level simulated transports—the **Broker** for cross-node MQTT routing, per-node virtual file systems, and a simulated clock—so capabilities such as FileTransfer, Modbus, Serial, MQTT, and InfluxDB can also operate offline.

### 3. Development Mode (Quick Start)

```bash
cd Simulator
npm install
npm run dev        # Open http://localhost:5173
```

```bash
npm run build      # Production build; output is written to dist/
npm run preview    # Preview the production build
```

The page initially loads an example topology containing one cloud node and two edge nodes. Drag templates from the left onto the canvas to create nodes and connect them into a topology. Select a node to mount components and execute commands on the right. Use the "✅ Test" tab to write and run offline test scenarios.

### 4. Ecosystem

The tool reproduces the main repository's component registry with embedded offline simulation implementations and requires no external drivers. Node templates include Standard Atom, Cloud, Edge, Sensor, Database, and Custom.

#### Implemented Data Components

| Name | Function | Key commands |
|------|----------|--------------|
| `BaseData` | Framework metadata (logo and version) | `logo` / `info` |
| `NetMapData` | Local node network topology (node name, interfaces, and default egress interface) | `info` / `set_node_name` / `interfaces` / `set_default_iface` |
| `KeyringData` | Shared secrets and token table | `status` / `set_secret` / `rotate` / `issue_token` / `revoke_*` |
| `ConfigData` | Flat dotted-path KV configuration | `get` / `set` / `delete` / `list` / `snapshot` |
| `MySQLData` / `PostgreSQLData` | Relational database public connection parameters and independent passwords | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |
| `SQLiteData` | SQLite file, schema, WAL, timeout, and connection-pool parameters | `configure` / `get_config` / `status` / `snapshot` |
| `RedisData` | Redis nodes, DB, TLS, timeout, connection pool, and independent password | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |
| `MongoDBData` | MongoDB nodes, authentication source, replica set, TLS, and independent password | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |
| `InfluxDBData` | InfluxDB endpoint, organization, bucket, timeout, and independent token | `configure` / `set_secret` / `clear_secret` / `get_config` / `status` / `snapshot` |

Database passwords and tokens are kept only in the private memory of the Data component. `get_config`, `snapshot`, and exported JSON never return them in plaintext. Every configuration or secret change increments `DatabaseStatus.Revision`.

#### Implemented Ability Components

| Name | Category | Core capabilities |
|------|----------|-------------------|
| `BaseAbility` | Basic | `list_data_names` / `list_ability_names` |
| `RoleAbility` | Basic | `describe` / `set_role` / `get_role` |
| `TimeAbility` | Basic | `sync_manual` / `sync_system` / `sync_net` / `sync_ntp` / `get_time` / `configure_run` |
| `NetMapAbility` | Basic | `register_peer` / `unregister_peer` / `update_peer` / `list_peers` / `lookup_peer` / `get_topology` |
| `OneKeyAbility` | Basic | `issue_token` / `verify_token` / `revoke_token` / `revoke_all` / `list_tokens` / `status` / `rotate` (HMAC-SHA256) |
| `CloudRoleAbility` | Basic | `describe` / `set_controller` / `get_controller` / `register_service` / `unregister_service` / `list_services` / `set_status` / `get_status` / `heartbeat` (all commands require `role=cloud`) |
| `EdgeRoleAbility` | Basic | `describe` / `set_zone` / `get_zone` / `add_capability` / `remove_capability` / `list_capabilities` / `set_capabilities` / `record_latency` / `get_metrics` / `set_online` (all commands require `role=edge`) |
| `CmdAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist` / `clear_finished` (an empty allowlist denies all commands; common commands are allowed by default) |
| `ShAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist` (based on CmdAbility using `sh -c`) |
| `BashAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist` (based on ShAbility using `bash --noprofile --norc -c`) |
| `ConfigFileAbility` | File / Configuration | `set_path` / `load` / `save` / `exists` (ConfigData-based JSON persistence) |
| `FileTransferAbility` | File / Configuration | `set_target` / `upload` / `download` / `list` / `get_transfer` / `cancel` (pluggable Transport) |
| `AlgorithmDistributionAbility` | File / Configuration | `register_algorithm` / `unregister_algorithm` / `distribute` / `list_distributions` / `cancel` (based on FileTransfer) |
| `ModbusAbility` | Industrial protocols | `set_endpoint` / `set_unit_id` / `read_holding` / `read_input` / `read_coils` / `read_discrete` / `write_*` (pluggable) |
| `SerialAbility` | Industrial protocols | `open` / `close` / `read` / `write` / `set_config` / `list_ports` (pluggable Transport) |
| `TSNAbility` | Industrial protocols | `set_interface` / `register_talker` / `register_listener` / `unregister` / `set_priority_map` / `set_time_aware` |
| `MQTTAbility` | Data exchange | `set_broker` / `connect` / `disconnect` / `publish` / `subscribe` / `drain` / `list_subscriptions` (cross-node routing through the world Broker with `+` / `#` support) |
| `InfluxDBAbility` | Data exchange | `set_endpoint` / `set_token` / `set_org` / `set_bucket` / `ping` / `write` / `query` / `list_series` / `delete_series` |
| `EKuiperAbility` | Data exchange | `set_endpoint` / `create_stream` / `drop_stream` / `create_rule` / `start_rule` / `stop_rule` / `show_rules` |
| `DockerAbility` | Container orchestration | `set_endpoint` / `list_containers` / `start/stop/restart/remove` / `pull_image` / `inspect` / `get_logs` / `create` |
| `KubernetesAbility` | Container orchestration | `set_context` / `apply` / `delete` / `list` / `get` / `scale` / `get_logs` |

In the main repository, capabilities that depend on external networks or processes—FileTransfer, Modbus, Serial, MQTT, InfluxDB, EKuiper, Docker, and Kubernetes—receive real drivers through `SetXxxTransport(...)`. This tool instead uses simulated transports, including the world Broker, per-node virtual file systems, and the simulated clock, to reproduce the same command semantics offline and make each command serve as executable documentation.

#### Cross-Node Composition Example

```js
// 1. The cloud node registers a peer through NetMap
runCommand(world, cloud.id, 'NetMapAbility', 'register_peer',
  { Name: 'edge-2', Address: '10.0.0.2:7000', Role: 'edge' })

// 2. The cloud node issues a short-lived token through OneKey
const tok = (await runCommand(world, cloud.id, 'OneKeyAbility', 'issue_token',
  { Subject: 'edge-2', TTL: 3600 })).Value

// 3. The edge subscribes, the cloud publishes, and the Broker routes across nodes
await runCommand(world, edge.id, 'MQTTAbility', 'subscribe', { Topic: 'edge/+/status' })
await runCommand(world, cloud.id, 'MQTTAbility', 'publish',
  { Topic: 'edge/2/status', Payload: 'online' })
const inbox = (await runCommand(world, edge.id, 'MQTTAbility', 'drain', {})).Value // Receives online
```

### 5. Design Philosophy

- Depend on abstractions, not on concrete implementations: simulated transports are structurally aligned with the injected transports in the main repository.
- Follow the Strategy, Command, and Composite patterns.
- All command arguments use strict types. Missing required arguments or type mismatches return `invalid command arguments`.
- Data and Ability dependencies are checked before command dispatch. Missing dependencies return explicit errors, and RoleAbility provides role gating for Cloud and Edge capabilities.
- Ability components that involve external networks reject `localhost`, `127.0.0.1`, `0.0.0.0`, and `::1` by default to reduce SSRF risk, including TimeAbility and SerialAbility.

### 6. Offline Testing

The right-side "✅ Test" tab supports multi-step scenarios. Each step specifies a node, component, command, JSON arguments, and assertions: expected success or failure, Value contains or equals, and Err contains. After execution, each step is marked PASS or FAIL and a complete command log remains in the console. Three sample scenarios are included: cross-node MQTT subscribe/publish, OneKey token issuance and verification, and ConfigData read/write with ConfigFile persistence.

The core engine consists of plain JavaScript modules in `src/core/` and does not depend on Vue, so it can be tested directly outside the browser:

```bash
node smoke.mjs        # 59 engine assertions: dispatch, dependencies, tokens, MQTT routing,
                      # configuration persistence, test assertions, and serialization round trips
```

### 7. Tests

```bash
npm run build         # Production build with Vite 7, Vue 3, and Vue Flow
node smoke.mjs        # Run the core-engine smoke tests
```

Current coverage: **59 passing assertions covering engine command dispatch, dependency checks, argument validation, OneKey HMAC tokens, cross-node MQTT routing, ConfigFile persistence, role gating, test assertions, and serialization / deserialization round trips; the production build completes without errors.**
