<div align="center">
  <img src="https://avatars.githubusercontent.com/u/245985800?s=200&v=4" alt="logo" width="100" />
  <h2>FasterEdge Simulator</h2>
  <h3>A Frontend-Only, Backend-Free Offline Orchestration and Testing Tool for FasterEdge</h3>
</div>

> **⚠️ Command-model notice**
>
> The canvas command model in this tool is **Atom / Ability**, from the early
> FasterEdge simulator. The graduation project uses the **Node / Component**
> model instead (a node is the largest unit of orchestration; above it sit
> capability components of forms binary / container / kernel-module / driver /
> archive). Its visual orchestration lives in
> [AIOperations/web](https://github.com/FasterEdge/AIOperations/tree/main/web).
>
> **The two are not the same system**: this repository's command model is not
> interchangeable with the project's Node/Component model, and orchestration
> produced here does not constitute project output. It is kept only for
> compatibility with early experiment data.

### 1. Introduction

- FasterEdge Simulator is an **offline simulation, orchestration, and testing tool** in the FasterEdge ecosystem. Opening the page takes you directly to a canvas with no login or backend. Like a network-topology tool, it lets you drag in nodes, connect them, mount Data / Ability components on each node, execute commands, and run offline test scenarios.
- It follows the command model of the main [FasterEdge](https://github.com/FasterEdge/FasterEdge) repository: a node is an **Atom**, Data components are its roots, and Ability components are its branches. All interactions use `Command(node, component, act, args) -> CommandOutput{Name, Value, Err}`. **The alignment is machine-verifiable and has a boundary**: component and command names are fully aligned (31 components / 226 commands on the Go side, `missingCommand` = 0), but the **parameter schemas are not** — 210 parameter-name/set differences, 17 simulator-only commands, and 6 nested-argument-struct differences are listed one by one in the contract diff in section 9. Do not read this as "the parameters correspond one to one" as well.
  Keep the two counts separate: **31 components / 226 commands on the Go side** (`contract.json`) versus **31 components / 243 commands in the Simulator registry** (`src/core/registry/*.js`, which is exactly what `node tools/contract/compare.mjs` reads). The extra 17 are the `extraCommand` set from section 9: the world clock (`TimeAbility.set_offset/advance/set_scale/freeze/clock_status`), MQTT QoS/retain observability (`puback/pubrec/pubcomp/redeliver/inflight/retained/stats`), topology reachability (`FileTransferAbility.check_link`), and `get_job`/`clear_finished` on Cmd/Sh/Bash. 226 + 17 = 243, item for item.
- All simulation logic—including the world, MQTT broker, simulated clock, virtual file systems, and command dispatch—runs in the browser. Data is automatically saved to `localStorage`, and JSON import and export support repeated offline orchestration and testing.

#### Directory Tree and the Role of Each New File

```
Simulator/
├── index.html                Vite entry HTML
├── vite.config.js            Vite config (Vue plugin + dev server on port 5173)
├── package.json / package-lock.json   dependencies and scripts (npm run test / build)
├── smoke.mjs                 engine smoke assertions (232 items, no DOM needed)
├── contract.json             command contract statically extracted from the main repo's Go source (31 components / 226 commands)
├── contract-baseline.json    contract-diff baseline (233 items, guarded by node --test)
├── src/
│   ├── main.js / App.vue / store.js / styles.css   Vue app shell and global state
│   ├── components/           8 Vue components: canvas, node, right inspector, test tab, …
│   └── core/
│       ├── engine.js         Command(node, component, act, args) dispatch + argument validation
│       ├── world.js          world state (nodes, links, logs, Broker, clock) in a Vue reactive container
│       ├── registry/         commands export and handlers for the 31 Data/Ability components
│       ├── clock.js          simulated clock (advance / set_scale / freeze / offset)
│       ├── netpolicy.js      address-policy grading, aligned with the main repo's address_policy.go
│       ├── trace.js          command-trace recording/replay and the deterministic environment (withDeterminism)
│       ├── testrunner.js     scenario DSL (multi-step assertions) and the bundled sample scenarios
│       ├── persistence.js    world serialize/hydrate and example topology construction
│       ├── crypto.js         HMAC-SHA256 / SHA-256 wrappers (used by OneKey / Keyring)
│       └── errors.js         unified error construction (invalid command arguments, …)
├── test/                     node:test assertions (contract-diff gatekeeping + trace replay, 23 items)
├── tools/contract/compare.mjs  contract comparer (registry ↔ contract.json schema-level diff)
├── scripts/trace.mjs         trace CLI (record / replay / selftest)
└── docs/parity.md            per-component validation cross-reference + structural difference list
```

The eight files added or completed in this work, and what each is for:

| File | Role | Guarded by |
|---|---|---|
| `src/core/netpolicy.js` | the repository's single address-decision entry point: IP-literal classification, `isDialableHost` (level-aware), `splitHostPort`, `isAcceptableHostname` (loopback aliases + ambiguous numeric hosts) | `smoke.mjs` group 30.14 |
| `src/core/clock.js` | the simulated clock: maps system time onto a time that can advance / fast-forward / freeze; `TimeAbility` and every engine timestamp read it | `smoke.mjs` clock group + `test/trace.test.mjs` |
| `src/core/trace.js` | command-trace recording/replay and the deterministic environment: a fixed clock plus a seeded `getRandomValues`; handlers execute for real, nothing is mocked | `test/trace.test.mjs` (23 items) |
| `scripts/trace.mjs` | the trace CLI: `record` / `replay` / `selftest`; exit code 1 means replay diverged | the end-to-end step in `.github/workflows/test.yml` |
| `tools/contract/compare.mjs` | the contract comparer: reads the registry's real exports and `contract.json` and emits the five diff kinds with counts | `test/contract.test.mjs` |
| `contract.json` | the static extraction of the main repo's Go source (`cmd/contract`): components, commands, argument JSON tags, three-valued requiredness | `test/contract.test.mjs` |
| `contract-baseline.json` | the diff baseline: `byKind` counts and `total`; adding or removing any command or argument on either side turns `node --test` red | `test/contract.test.mjs` |
| `docs/parity.md` | the per-component validation cross-reference plus 12 structural differences, spelling out "what is deliberately inconsistent" | maintained by hand, keywords aligned with `smoke.mjs` group 30 |

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
| `KeyringData` | Shared secrets and token table | `status` / `set_secret` / `rotate` / `issue_token` / `list_tokens` / `revoke_token` / `revoke_all` |
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
| `TimeAbility` | Basic | `sync_manual` / `sync_system` / `sync_net` / `sync_ntp` / `get_time` / `last` / `set_offset` / `advance` / `set_scale` / `freeze` / `clock_status` / `configure_run` |
| `NetMapAbility` | Basic | `register_peer` / `unregister_peer` / `update_peer` / `list_peers` / `lookup_peer` / `get_topology` |
| `OneKeyAbility` | Basic | `issue_token` / `verify_token` / `revoke_token` / `revoke_all` / `list_tokens` / `status` / `rotate` (HMAC-SHA256) |
| `CloudRoleAbility` | Basic | `describe` / `set_controller` / `get_controller` / `register_service` / `unregister_service` / `list_services` / `set_status` / `get_status` / `heartbeat` (all commands require `role=cloud`) |
| `EdgeRoleAbility` | Basic | `describe` / `set_zone` / `get_zone` / `add_capability` / `remove_capability` / `list_capabilities` / `set_capabilities` / `record_latency` / `get_metrics` / `set_online` (all commands require `role=edge`) |
| `CmdAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `get_job` / `clear_finished` / `set_allowlist` / `get_allowlist` / `set_allowlist_any` (an empty allowlist denies all commands; common commands are allowed by default, and `set_allowlist_any` is the only opt-in for allowing everything) |
| `ShAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `get_job` / `clear_finished` / `set_allowlist` / `get_allowlist` / `set_allowlist_any` (based on CmdAbility using `sh -c`) |
| `BashAbility` | Terminal | `run` / `start` / `wait` / `kill` / `list` / `get_job` / `clear_finished` / `set_allowlist` / `get_allowlist` / `set_allowlist_any` (based on ShAbility using `bash --noprofile --norc -c`) |
| `ConfigFileAbility` | File / Configuration | `set_path` / `get_path` / `load` / `save` / `exists` (ConfigData-based JSON persistence) |
| `FileTransferAbility` | File / Configuration | `set_target` / `get_target` / `upload` / `download` / `check_link` / `list` / `get_transfer` / `clear_finished` / `cancel` (pluggable Transport, topology-connectivity gated) |
| `AlgorithmDistributionAbility` | File / Configuration | `register_algorithm` / `unregister_algorithm` / `get_algorithm` / `list_algorithms` / `distribute` / `list_distributions` / `clear_finished` / `cancel` (based on FileTransfer) |
| `ModbusAbility` | Industrial protocols | `set_endpoint` / `get_endpoint` / `set_unit_id` / `get_unit_id` / `read_holding` / `read_input` / `read_coils` / `read_discrete` / `write_coil` / `write_holding` / `write_holding_multi` (pluggable) |
| `SerialAbility` | Industrial protocols | `open` / `is_open` / `close` / `read` / `write` / `set_config` / `get_config` / `list_ports` (pluggable Transport) |
| `TSNAbility` | Industrial protocols | `set_interface` / `get_interface` / `register_talker` / `register_listener` / `unregister` / `list_streams` / `set_priority_map` / `get_priority_map` / `set_time_aware` / `get_time_aware` |
| `MQTTAbility` | Data exchange | `set_broker` / `get_broker` / `set_client_id` / `set_credentials` / `connect` / `is_connected` / `disconnect` / `subscribe` / `unsubscribe` / `list_subscriptions` / `publish` / `drain` / `puback` / `pubrec` / `pubcomp` / `redeliver` / `inflight` / `retained` / `stats` (cross-node routing through the world Broker with `+` / `#`, retained messages, and QoS 0/1/2) |
| `InfluxDBAbility` | Data exchange | `set_endpoint` / `get_endpoint` / `set_token` / `set_org` / `set_bucket` / `get_config` / `ping` / `write` / `query` / `list_series` / `delete_series` |
| `EKuiperAbility` | Data exchange | `set_endpoint` / `get_endpoint` / `create_stream` / `get_stream` / `list_streams` / `drop_stream` / `create_rule` / `get_rule_status` / `drop_rule` / `start_rule` / `stop_rule` / `show_rules` |
| `DockerAbility` | Container orchestration | `set_endpoint` / `get_endpoint` / `list_containers` / `create_container` / `start_container` / `stop_container` / `restart_container` / `remove_container` / `inspect_container` / `pull_image` / `get_logs` |
| `KubernetesAbility` | Container orchestration | `set_context` / `get_context` / `apply` / `delete` / `list` / `get` / `scale` / `get_logs` |

The command names above are taken one by one from the `commands` export of `src/core/registry/*.js` (31 components / 243 commands — the same object section 9's `node tools/contract/compare.mjs` reads). The machine-checkable version is the diff in section 9; this table is a human-readable summary.

One measured note on the Cmd/Sh/Bash job commands: all three export the identical set, `run`/`start`/`wait`/`kill`/`list`/`get_job`/`clear_finished`/`set_allowlist`/`get_allowlist`/`set_allowlist_any` (they share `makeCmdAbility` in `src/core/registry/ability-terminal.js`, reproducible with `node smoke.mjs`). They still appear one by one in section 9's `extraCommand` because of the **main repository** side: `ability/sh_ability.go:365-374` (`shAbilityCommands`) and `ability/bash_ability.go:197-206` (`bashAbilityCommands`) forward only `wait`/`kill`/`list`, and the comment states plainly that "CmdAbility's get_job / clear_finished are not forwarded — therefore ListCommands must not contain these two parent commands. Reporting them would make Atom.CommandNames export a catalogue that cannot be invoked." So all three simulator components expose two commands more than Go, which is the simulator going beyond the main repository rather than missing anything (`missingCommand` is 0).

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
- Ability components that involve external networks reject `localhost`, `127.0.0.1`, `0.0.0.0`, and `::1` by default to reduce SSRF risk, including TimeAbility, MQTTAbility, and NetMapAbility.

#### Address Policy Grading

`src/core/netpolicy.js` is the simulator's **single** address-decision entry point (`ability-core.js` / `ability-external.js` / `ability-industrial.js` / `data.js` all import from it), aligned with `CheckAddr` / `CheckHost` in the main repo's `ability/address_policy.go`. There the caller picks the level explicitly; here the simulator always uses `allowPrivate: true`:

| Address class | Main repo (any level) | Main repo `PublicOnly` | Main repo `AllowPrivate` / `AllowLoopback` | Simulator (`allowPrivate: true`) |
|---|---|---|---|---|
| Loopback `127/8`, `::1` | reject | reject | allowed from `AllowLoopback` | reject (see `docs/parity.md` structural difference) |
| Unspecified `0.0.0.0`, `::` | reject | reject | reject | reject |
| Multicast `224/4`, `ff00::/8` | reject | reject | reject | reject |
| Link-local `169.254/16`, `fe80::/10` | reject | reject | reject | reject |
| **Limited broadcast `255.255.255.255/32`** | **reject** | reject | reject | **reject** |
| RFC1918 `10/8`, `172.16/12`, `192.168/16`, ULA `fc00::/7` | allow | reject | allow | allow |
| Reserved/documentation ranges `192.0.2/24`, `198.51.100/24`, `203.0.113/24`, `198.18/15`, `100.64/10`, `192.0.0/24`, `192.88.99/24`, `240/4` | allow | reject | allow | allow |
| Publicly routable | allow | allow | allow | allow |

Three points worth noting:

- **Limited broadcast is not private space.** `255.255.255.255` goes through `isAlwaysRejectedAddr` in the main repo (`ability/address_policy.go:78-83`) and is rejected at every level; the simulator gives it its own `broadcast` branch in `ipKind()`, decided before `private`, so the tightened level never lets it through either.
- **`localhost` / `*.localhost` aliases and ambiguous numeric hosts** (`127.1`, `0x7f.0.0.1`, `2130706433`, `0177.0.0.1`) are rejected on both sides—those spellings resolve differently on Windows and glibc, so they are treated as unauditable addresses.
- **The tightened path is available**: `isDialableHost(host, { allowPrivate: false })` is the equivalent of `AddressPolicyPublicOnly`, and `node smoke.mjs` group 30.14 asserts, one by one, that `255.255.255.255`, `240.0.0.1`, `198.18.0.1`, `198.19.255.255`, `192.0.2.5`, and `100.64.0.1` are all rejected once tightened.

### 6. Offline Testing

The right-side "✅ Test" tab supports multi-step scenarios. Each step specifies a node, component, command, JSON arguments, and assertions: expected success or failure, Value contains or equals, and Err contains. After execution, each step is marked PASS or FAIL and a complete command log remains in the console. Three sample scenarios are included: cross-node MQTT subscribe/publish, OneKey token issuance and verification, and ConfigData read/write with ConfigFile persistence.

The core engine consists of plain JavaScript modules in `src/core/` and can be tested directly outside the browser; the only Vue dependency inside the engine is `src/core/world.js:6`, `import { reactive, markRaw } from 'vue'` (world state lives in a Vue reactive container so the canvas repaints automatically). Every other module—engine, registry, trace, testrunner, clock, netpolicy, persistence—is dependency-free plain JS:

```bash
npm run test          # One command: smoke.mjs (232 assertions) + test/ (23 node:test assertions)
node smoke.mjs        # 232 engine assertions: dispatch, dependencies, tokens, MQTT routing with
                      # retained messages and QoS 0/1/2, the simulated clock, topology
                      # connectivity, configuration persistence, test assertions, serialization
                      # round trips, and address-policy grading
node --test           # 23 assertions for trace recording / replay and serialization round trips
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
npm run build         # Production build with Vite 8, Vue 3, and Vue Flow
```

Current coverage: **232 passing assertions covering engine command dispatch, dependency checks, argument validation, OneKey HMAC tokens, cross-node MQTT routing (including retained delivery and the QoS 0/1/2 two-phase acknowledgement and de-duplication flow), simulated clock advance and fast-forward, FileTransfer topology connectivity gating, ConfigFile persistence, role gating, test assertions, serialization / deserialization round trips, and address-policy grading (restricted broadcast plus reserved ranges); plus 23 assertions for trace recording / replay and state round trips (command logs and end state byte-identical after record → JSON → replay, tampering always detected, and round-trip equivalence for links, Broker runtime state, and clock snapshots); the production build completes without errors.** CI lives in `.github/workflows/test.yml`.

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

Current baseline (`contract.json` at schemaVersion 1): 31 components / 226 commands / 198 command constants on the Go side; 233 differences = `missingCommand` 0 + `extraCommand` 17 + `argNameDiff` 210 + `requiredDiff` 0 + `shapeDiff` 6. The same registry holds 31 components / 243 commands on the Simulator side, and 226 + 17 = 243 matches the `extraCommand` count item for item.

Those 233 are **real, known inconsistencies**, in two groups, and none of them is fixed yet:

- `extraCommand` (17): extra commands the simulator offers for the world clock (`TimeAbility.set_offset/advance/set_scale/freeze/clock_status`), MQTT QoS/retain observability (`puback/pubrec/pubcomp/redeliver/inflight/retained/stats`), topology reachability (`FileTransferAbility.check_link`), and `get_job`/`clear_finished` on Cmd/Sh/Bash. These **go beyond the main repository** and are documented above as "semantics boundaries of the simulated transports" rather than passed off as main-repository commands.
  For `get_job`/`clear_finished` the difference is in the **exposed surface**, not the implementation: the simulator shares one command table across all three (`makeCmdAbility` in `src/core/registry/ability-terminal.js`), whereas the main repo's `shAbilityCommands` (`ability/sh_ability.go:365-374`) and `bashAbilityCommands` (`ability/bash_ability.go:197-206`) forward only `wait`/`kill`/`list`, with a comment stating plainly that "CmdAbility's get_job / clear_finished are not forwarded — therefore ListCommands must not contain these two parent commands. Reporting them would make Atom.CommandNames export a catalogue that cannot be invoked." So all three simulator components expose two more callable commands than Go. The direction is the opposite of a gap: `missingCommand` is 0.
- `argNameDiff` (210): the main repository names parameters differently (`IDOrName/JobID/Address/Quantity` versus `Id/Start/Count`) or supports parameters the simulator does not expose (`Timeout/Env/Scope/Nonce`, and others). **This is the "fully aligned command model" that has not been delivered**: what aligns today is the command *names*, not the parameter schemas.

`requiredDiff` is 0 only because the main repository almost never records requiredness (Go has no tag for it); static analysis can only spot the 10 places that reject an empty value explicitly. That metric's reliability is limited by this, so it must not be cited as evidence that argument validation is equivalent.
