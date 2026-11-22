<div align="center">
  <img src="https://avatars.githubusercontent.com/u/245985800?s=200&v=4" alt="logo" width="100" />
  <h2>FasterEdge Simulator</h2>
  <h3>A Frontend-Only, Backend-Free Offline Orchestration and Testing Tool for FasterEdge</h3>
</div>

### 1. Introduction

- FasterEdge Simulator is an **offline simulation, orchestration, and testing tool** in the FasterEdge ecosystem. Opening the page takes you directly to a canvas with no login or backend. Like a network-topology tool, it lets you drag in nodes, connect them, mount Data / Ability components on each node, execute commands, and run offline test scenarios.
- It follows the command model of the main [FasterEdge](https://github.com/FasterEdge/FasterEdge) repository: a node is an **Atom**, Data components are its roots, and Ability components are its branches. All interactions use `Command(node, component, act, args) -> CommandOutput{Name, Value, Err}`. **The alignment is machine-verifiable and has a boundary**: component and command names are fully aligned (31 components / 226 commands, `missingCommand` = 0), but the **parameter schemas are not** — 210 parameter-name/set differences, 17 simulator-only commands, and 6 nested-argument-struct differences are listed one by one in the contract diff in section 9. Do not read this as "the parameters correspond one to one" as well.
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

The tool implements a component registry with the same names as the main repository, using embedded offline simulation implementations and requiring no external drivers. Node templates include Standard Atom, Cloud, Edge, Sensor, Database, and Custom. **"Implemented" means the command name is dispatchable in the registry; it does not mean the parameter schema matches the main repository** (see the contract diff in section 9).

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
| `TimeAbility` | Basic | `sync_manual` / `sync_system` / `sync_net` / `sync_ntp` / `get_time` / `set_offset` / `advance` / `set_scale` / `freeze` / `clock_status` / `configure_run` |
| `NetMapAbility` | Basic | `register_peer` / `unregister_peer` / `update_peer` / `list_peers` / `lookup_peer` / `get_topology` |
| `OneKeyAbility` | Basic | `issue_token` / `verify_token` / `revoke_token` / `revoke_all` / `list_tokens` / `status` / `rotate` (HMAC-SHA256) |
| `CloudRoleAbility` | Basic | `describe` / `set_controller` / `get_controller` / `register_service` / `unregister_service` / `list_services` / `set_status` / `get_status` / `heartbeat` (all commands require `role=cloud`) |
| `EdgeRoleAbility` | Basic | `describe` / `set_zone` / `get_zone` / `add_capability` / `remove_capability` / `list_capabilities` / `set_capabilities` / `record_latency` / `get_metrics` / `set_online` (all commands require `role=edge`) |
| `CmdAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist` / `clear_finished` (an empty allowlist denies all commands; common commands are allowed by default) |
| `ShAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist` (based on CmdAbility using `sh -c`) |
| `BashAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `set_allowlist` (based on ShAbility using `bash --noprofile --norc -c`) |
| `ConfigFileAbility` | File / Configuration | `set_path` / `load` / `save` / `exists` (ConfigData-based JSON persistence) |
| `FileTransferAbility` | File / Configuration | `set_target` / `upload` / `download` / `check_link` / `list` / `get_transfer` / `cancel` (pluggable Transport, topology-connectivity gated) |
| `AlgorithmDistributionAbility` | File / Configuration | `register_algorithm` / `unregister_algorithm` / `distribute` / `list_distributions` / `cancel` (based on FileTransfer) |
| `ModbusAbility` | Industrial protocols | `set_endpoint` / `set_unit_id` / `read_holding` / `read_input` / `read_coils` / `read_discrete` / `write_*` (pluggable) |
| `SerialAbility` | Industrial protocols | `open` / `close` / `read` / `write` / `set_config` / `list_ports` (pluggable Transport) |
| `TSNAbility` | Industrial protocols | `set_interface` / `register_talker` / `register_listener` / `unregister` / `set_priority_map` / `set_time_aware` |
| `MQTTAbility` | Data exchange | `set_broker` / `connect` / `disconnect` / `publish` / `subscribe` / `drain` / `list_subscriptions` / `inflight` / `puback` / `pubrec` / `pubcomp` / `redeliver` / `retained` / `stats` (cross-node routing through the world Broker with `+` / `#`, retained messages, and QoS 0/1/2) |
| `InfluxDBAbility` | Data exchange | `set_endpoint` / `set_token` / `set_org` / `set_bucket` / `ping` / `write` / `query` / `list_series` / `delete_series` |
| `EKuiperAbility` | Data exchange | `set_endpoint` / `create_stream` / `drop_stream` / `create_rule` / `start_rule` / `stop_rule` / `show_rules` |
| `DockerAbility` | Container orchestration | `set_endpoint` / `list_containers` / `start/stop/restart/remove` / `pull_image` / `inspect` / `get_logs` / `create` |
| `KubernetesAbility` | Container orchestration | `set_context` / `apply` / `delete` / `list` / `get` / `scale` / `get_logs` |

Three semantics boundaries of the simulated transports (differences from the real drivers in the main repository, each reproducible with `node smoke.mjs`):

- **Simulated clock**: `world.clockOffsetMs` is the world clock offset relative to system time, carried by `src/core/clock.js`. Every engine timestamp (logs, transfer records, broker delivery time) reads it. `TimeAbility.advance` advances it manually, `set_scale` sets the fast-forward rate, `freeze` pauses and resumes it, `clock_status` reads it back, and the state survives a serialization / hydration round trip.
- **MQTT delivery semantics**: the effective QoS is `min(publish QoS, subscription QoS)`, and when several filters match one topic the most specific filter wins. `Retain=true` stores the latest message and replays it on subscription and reconnect; an empty payload clears the stored message. QoS 1 is at-least-once (`puback` acknowledges it, and `redeliver` re-sends an unacknowledged message, so duplicate delivery is observable). QoS 2 is exactly-once and two-phase: the message reaches the application only after `pubrec`, a repeated `pubrec` only de-duplicates instead of re-delivering, and `pubcomp` releases it from the in-flight table.
- **Topology connectivity**: `FileTransferAbility` and `AlgorithmDistributionAbility` run BFS over `world.links` and fail with `no link path from "A" to "B" in topology` when the nodes are disconnected. `check_link` probes the path and hop count on its own.

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
npm run test          # One command: smoke.mjs (122 assertions) + test/ (20 node:test assertions)
node smoke.mjs        # 122 engine assertions: dispatch, dependencies, tokens, MQTT routing with
                      # retained messages and QoS 0/1/2, the simulated clock, topology
                      # connectivity, configuration persistence, test assertions, and serialization
node --test           # 20 assertions for trace recording / replay and serialization round trips
```

### 7. Command Trace Recording and Replay

Beyond the single-command assertions of the scenario DSL, `src/core/trace.js` adds **command execution trace recording and replay**. A command sequence is executed for real, and each command's `CommandOutput`, command log entry, and the resulting world end state are written to JSON. On replay, the world is rebuilt from the initial world embedded in the trace, the same sequence is executed again, and every output and log entry is compared along with the final state.

Replay can only reproduce a run once the external inputs are pinned, so both recording and replay run inside a **deterministic environment** (`withDeterminism`): a fixed simulated clock plus a seeded `getRandomValues`. The command handlers themselves run normally — nothing is mocked.

```bash
# Record a sample scenario to JSON
node scripts/trace.mjs record --scenario 0 --out trace-mqtt.json
# Replay and compare against the recording (exit code 1 and diff paths on mismatch)
node scripts/trace.mjs replay trace-mqtt.json
# End-to-end self-check: record → JSON → replay
node scripts/trace.mjs selftest --scenario 1
```

Replay differences are reported with exact paths, for example `[step#0] out.Value.connected: expected false, actual true`, instead of a generic "not equal".

### 8. Tests

```bash
npm run test          # All offline tests green (smoke.mjs + node --test)
npm run build         # Production build with Vite 7, Vue 3, and Vue Flow
```

Current coverage: **122 passing assertions covering engine command dispatch, dependency checks, argument validation, OneKey HMAC tokens, cross-node MQTT routing (including retained delivery and the QoS 0/1/2 two-phase acknowledgement and de-duplication flow), simulated clock advance and fast-forward, FileTransfer topology connectivity gating, ConfigFile persistence, role gating, test assertions, and serialization / deserialization round trips; plus 20 assertions for trace recording / replay and state round trips (command logs and end state byte-identical after record → JSON → replay, tampering always detected, and round-trip equivalence for links, Broker runtime state, and clock snapshots); the production build completes without errors.** CI lives in `.github/workflows/test.yml`.

### 9. Command-Contract Diff Against the Main Repository

The command lists in the tables above are written by hand and drift away from the Go source of the main `FasterEdge` repository. To align them with a machine instead of human eyes, the project ships **contract extraction plus diffing**:

```bash
# 1. In the main repository, statically extract the command contract from Go source
cd ../FasterEdge && go run ./cmd/contract -out contract/contract.json

# 2. Diff that contract against the real dispatch in this repo's src/core/registry/*.js
cd ../Simulator && node tools/contract/compare.mjs [contract.json] [--verbose] [--strict]
```

The extractor reads the `switch act` branches of every component's `Command()` in `ability/` and `data/` together with the `args.(XxxArgs)` type assertions (including branches reached through helpers such as `simpleContainerAction` and `sqlCommand`), and emits the JSON tag, the Go type, and a three-valued requiredness (`required` when the dispatch branch explicitly rejects the zero value, `optional` for `omitempty` or a comment saying optional, and `unknown` when it cannot be decided statically; `unknown` never takes part in the requiredness verdict).

The comparer reports five kinds of difference: `missingCommand` (present in Go, absent here), `extraCommand` (invented here), `argNameDiff` (parameter names differ), `requiredDiff` (requiredness differs), and `shapeDiff` (Go nests its argument struct while the simulator passes flat arguments). The baseline lives in `contract-baseline.json` and is guarded by `node --test`: **adding or removing a command or parameter on either side turns the test red**, forcing a human to inspect the diff and then either fix the code or update the baseline, with no silent drift.

Current baseline (`contract.json` at schemaVersion 1): 31 components / 226 commands / 198 command constants on the Go side; 233 differences = `missingCommand` 0 + `extraCommand` 17 + `argNameDiff` 210 + `requiredDiff` 0 + `shapeDiff` 6.

Those 233 are **real, known inconsistencies**, in two groups, and none of them is fixed yet:

- `extraCommand` (17): extra commands the simulator offers for the world clock (`TimeAbility.set_offset/advance/set_scale/freeze/clock_status`), MQTT QoS/retain observability (`puback/pubrec/pubcomp/redeliver/inflight/retained/stats`), topology reachability (`FileTransferAbility.check_link`), and `get_job`/`clear_finished` on Sh/Bash. These **go beyond the main repository** and are documented above as "semantics boundaries of the simulated transports" rather than passed off as main-repository commands.
- `argNameDiff` (210): the main repository names parameters differently (`IDOrName/JobID/Address/Quantity` versus `Id/Start/Count`) or supports parameters the simulator does not expose (`Timeout/Env/Scope/Nonce`, and others). **This is the "fully aligned command model" that has not been delivered**: what aligns today is the command *names*, not the parameter schemas.

`requiredDiff` is 0 only because the main repository almost never records requiredness (Go has no tag for it); static analysis can only spot the 10 places that reject an empty value explicitly. That metric's reliability is limited by this, so it must not be cited as evidence that argument validation is equivalent.
