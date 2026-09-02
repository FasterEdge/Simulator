// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
import { ok, fail, invalid, unsupported } from '../errors.js'
import { randomHex, randomToken, hmacSignBase64Url, strToBytes } from '../crypto.js'
import { KeyringData } from './data.js'
const keyringCommands = KeyringData.commands

// 与主仓库一致：允许 host:port / 纯 IP / 主机名（不含协议前缀、不含路径、不含非法字符）
function validPeerAddress(addr) {
  if (!addr || typeof addr !== 'string' || !addr) return false
  if (/[\s/\\?#]/.test(addr)) return false
  // host:port 形式：要求 host 非空、端口为 1-65535 数字
  const ci = addr.lastIndexOf(':')
  if (ci > 0) {
    const host = addr.slice(0, ci)
    const port = addr.slice(ci + 1)
    if (!host || !/^\d{1,5}$/.test(port)) return false
    const pn = Number(port)
    if (!(pn >= 1 && pn <= 65535)) return false
    return true
  }
  // 纯 IP 或主机名：仅允许字母数字、点、连字符、下划线
  return /^[a-zA-Z0-9._-]+$/.test(addr)
}

function nowIso() {
  return new Date().toISOString()
}

// ============================================================
// BaseAbility
// ============================================================
export const BaseAbility = {
  name: 'BaseAbility',
  kind: 'ability',
  category: '基础',
  describe: 'BaseAbility 提供查询节点上已注册 Data 与 Ability 名称的基础能力。',
  deps: ['BaseData'],
  initState: () => ({}),
  commands: {
    list_data_names: {
      describe: '列出本节点全部 Data 组件名',
      args: [],
      handler: async (ctx) => ok(Object.keys(ctx.node.data).sort()),
    },
    list_ability_names: {
      describe: '列出本节点全部 Ability 组件名',
      args: [],
      handler: async (ctx) => ok(Object.keys(ctx.abilities).sort()),
    },
  },
}

// ============================================================
// RoleAbility
// ============================================================
export const RoleAbility = {
  name: 'RoleAbility',
  kind: 'ability',
  category: '基础',
  describe: 'RoleAbility 提供节点角色管理能力。',
  deps: ['BaseData'],
  initState: () => ({ role: '' }),
  commands: {
    describe: {
      describe: '返回能力描述',
      args: [],
      handler: async (ctx, a, s) => ok('提供角色管理的能力。'),
    },
    set_role: {
      describe: '设置节点角色（如 cloud / edge / sensor）',
      args: [{ key: 'Role', label: '角色', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        if (!String(a.Role || '').trim()) return fail(invalid('role empty'))
        s.role = String(a.Role).trim()
        return ok('角色设置成功')
      },
    },
    get_role: {
      describe: '获取当前角色',
      args: [],
      handler: async (ctx, a, s) => ok(s.role),
    },
  },
}

// ============================================================
// CloudRoleAbility（依赖 RoleAbility 且 role=cloud）
// ============================================================
export const CloudRoleAbility = {
  name: 'CloudRoleAbility',
  kind: 'ability',
  category: '基础',
  describe: 'CloudRoleAbility 提供云端控制面能力：服务注册、状态上报与心跳。',
  deps: ['BaseData', 'RoleAbility'],
  _requireRole: 'cloud',
  initState: () => ({ controller: '', services: {}, status: 'online', lastHeartbeat: null }),
  commands: {
    describe: {
      describe: '返回能力描述',
      args: [],
      handler: async (ctx, a, s) => ok('提供云端角色管理能力。'),
    },
    set_controller: {
      describe: '设置云端控制端地址',
      args: [{ key: 'Address', label: '控制端地址', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const role = ctx.node.abilities.RoleAbility?.role
        if (role !== 'cloud') return fail(invalid('requires role=cloud'))
        s.controller = String(a.Address).trim()
        return ok(s.controller)
      },
    },
    get_controller: {
      describe: '获取云端控制端地址',
      args: [],
      handler: async (ctx, a, s) => ok(s.controller),
    },
    register_service: {
      describe: '注册云端服务',
      args: [
        { key: 'Name', label: '服务名', type: 'string', required: true },
        { key: 'Address', label: '服务地址', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        if (ctx.node.abilities.RoleAbility?.role !== 'cloud') return fail(invalid('requires role=cloud'))
        s.services[String(a.Name).trim()] = { name: String(a.Name).trim(), address: String(a.Address).trim(), status: 'registered' }
        return ok(s.services[String(a.Name).trim()])
      },
    },
    unregister_service: {
      describe: '注销云端服务',
      args: [{ key: 'Name', label: '服务名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = String(a.Name).trim()
        if (!s.services[name]) return fail(invalid(`service "${name}" not found`))
        const svc = s.services[name]
        delete s.services[name]
        return ok(svc)
      },
    },
    list_services: {
      describe: '列出已注册服务',
      args: [],
      handler: async (ctx, a, s) => ok(Object.values(s.services)),
    },
    set_status: {
      describe: '设置云节点状态',
      args: [{ key: 'Status', label: '状态', type: 'select', options: ['online', 'degraded', 'offline'] }],
      handler: async (ctx, a, s) => {
        s.status = a.Status || 'online'
        return ok(s.status)
      },
    },
    get_status: {
      describe: '获取节点状态',
      args: [],
      handler: async (ctx, a, s) => ok(s.status),
    },
    heartbeat: {
      describe: '上报心跳',
      args: [],
      handler: async (ctx, a, s) => {
        if (ctx.node.abilities.RoleAbility?.role !== 'cloud') return fail(invalid('requires role=cloud'))
        s.lastHeartbeat = Date.now()
        return ok({ controller: s.controller, status: s.status, lastHeartbeat: new Date(s.lastHeartbeat).toISOString() })
      },
    },
  },
}

// ============================================================
// EdgeRoleAbility（依赖 RoleAbility 且 role=edge）
// ============================================================
export const EdgeRoleAbility = {
  name: 'EdgeRoleAbility',
  kind: 'ability',
  category: '基础',
  describe: 'EdgeRoleAbility 提供边缘节点能力：区域、能力清单、延迟指标与在线状态。',
  deps: ['BaseData', 'RoleAbility'],
  _requireRole: 'edge',
  initState: () => ({ zone: '', capabilities: [], latency: [], metrics: {}, online: false }),
  commands: {
    describe: {
      describe: '返回能力描述',
      args: [],
      handler: async (ctx, a, s) => ok('提供边缘角色管理能力。'),
    },
    set_zone: {
      describe: '设置边缘区域',
      args: [{ key: 'Zone', label: '区域', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        if (ctx.node.abilities.RoleAbility?.role !== 'edge') return fail(invalid('requires role=edge'))
        s.zone = String(a.Zone).trim()
        return ok(s.zone)
      },
    },
    get_zone: {
      describe: '获取边缘区域',
      args: [],
      handler: async (ctx, a, s) => ok(s.zone),
    },
    add_capability: {
      describe: '添加能力',
      args: [{ key: 'Name', label: '能力名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        if (ctx.node.abilities.RoleAbility?.role !== 'edge') return fail(invalid('requires role=edge'))
        const name = String(a.Name).trim()
        if (!s.capabilities.includes(name)) s.capabilities.push(name)
        return ok(name)
      },
    },
    remove_capability: {
      describe: '移除能力',
      args: [{ key: 'Name', label: '能力名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = String(a.Name).trim()
        const i = s.capabilities.indexOf(name)
        if (i < 0) return fail(invalid(`capability "${name}" not found`))
        s.capabilities.splice(i, 1)
        return ok(name)
      },
    },
    list_capabilities: {
      describe: '列出全部能力',
      args: [],
      handler: async (ctx, a, s) => ok([...s.capabilities]),
    },
    set_capabilities: {
      describe: '整体覆盖能力清单（JSON 数组）',
      args: [{ key: 'Names', label: '能力名数组', type: 'json' }],
      handler: async (ctx, a, s) => {
        const arr = Array.isArray(a.Names) ? a.Names : []
        s.capabilities = arr.map(String)
        return ok([...s.capabilities])
      },
    },
    record_latency: {
      describe: '记录一次延迟采样(ms)',
      args: [{ key: 'LatencyMs', label: '延迟(ms)', type: 'number', required: true }],
      handler: async (ctx, a, s) => {
        s.latency.push(Number(a.LatencyMs))
        if (s.latency.length > 100) s.latency.shift()
        return ok(s.latency.length)
      },
    },
    get_metrics: {
      describe: '返回聚合延迟指标',
      args: [],
      handler: async (ctx, a, s) => {
        const arr = s.latency
        const sum = arr.reduce((x, y) => x + y, 0)
        const metrics = {
          samples: arr.length,
          avgMs: arr.length ? Math.round((sum / arr.length) * 10) / 10 : 0,
          minMs: arr.length ? Math.min(...arr) : 0,
          maxMs: arr.length ? Math.max(...arr) : 0,
          last: arr.length ? arr[arr.length - 1] : 0,
        }
        s.metrics = metrics
        return ok(metrics)
      },
    },
    set_online: {
      describe: '设置在线状态',
      args: [{ key: 'Online', label: '在线', type: 'bool' }],
      handler: async (ctx, a, s) => {
        s.online = Boolean(a.Online)
        return ok(s.online)
      },
    },
  },
}

// ============================================================
// TimeAbility（模拟时钟：世界时钟 + 偏移）
// ============================================================
export const TimeAbility = {
  name: 'TimeAbility',
  kind: 'ability',
  category: '基础',
  describe: 'TimeAbility 提供时间同步与查询能力（离线模拟：基于世界时钟 + 偏移量）。',
  deps: ['BaseData'],
  initState: () => ({ offsetMs: 0, lastSync: null, source: 'system' }),
  commands: {
    sync_manual: {
      describe: '手动指定时间（ISO 字符串或 unix 秒）',
      args: [{ key: 'Value', label: '时间值', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const v = String(a.Value).trim()
        const t = /^\d+$/.test(v) ? new Date(Number(v) * 1000) : new Date(v)
        if (Number.isNaN(t.getTime())) return fail(invalid('cannot parse time'))
        s.offsetMs = t.getTime() - Date.now()
        s.source = 'manual'
        s.lastSync = Date.now()
        return ok({ time: t.toISOString(), offsetMs: s.offsetMs, source: s.source })
      },
    },
    sync_system: {
      describe: '与系统时间对齐（重置偏移）',
      args: [],
      handler: async (ctx, a, s) => {
        s.offsetMs = 0
        s.source = 'system'
        s.lastSync = Date.now()
        return ok({ time: new Date().toISOString(), offsetMs: 0, source: s.source })
      },
    },
    sync_net: {
      describe: '从网络时间源同步（模拟成功，拒绝本地地址）',
      args: [{ key: 'URL', label: '时间源 URL', type: 'string' }],
      handler: async (ctx, a, s) => {
        const url = String(a.URL || 'https://timeapi.io/api/Time/current/zone?timeZone=Asia/Shanghai')
        if (/^(localhost|127\.|0\.0\.0\.0|::1)/.test(url)) return fail(invalid('address not allowed'))
        s.offsetMs = 0
        s.source = 'network'
        s.lastSync = Date.now()
        return ok({ time: new Date().toISOString(), offsetMs: 0, source: s.source, url })
      },
    },
    sync_ntp: {
      describe: '从 NTP 服务器同步（模拟成功，拒绝本地地址）',
      args: [{ key: 'Address', label: 'NTP 服务器', type: 'string' }],
      handler: async (ctx, a, s) => {
        const addr = String(a.Address || 'pool.ntp.org')
        if (/^(localhost|127\.|0\.0\.0\.0|::1)/.test(addr)) return fail(invalid('address not allowed'))
        s.offsetMs = 0
        s.source = 'ntp'
        s.lastSync = Date.now()
        return ok({ time: new Date().toISOString(), offsetMs: 0, source: s.source, server: addr })
      },
    },
    last: {
      describe: '最近一次同步信息',
      args: [],
      handler: async (ctx, a, s) =>
        ok(s.lastSync ? { source: s.source, at: new Date(s.lastSync).toISOString() } : 'never synced'),
    },
    get_time: {
      describe: '读取当前（模拟）时间',
      args: [],
      handler: async (ctx, a, s) => ok(new Date(Date.now() + s.offsetMs).toISOString()),
    },
    configure_run: {
      describe: '配置运行模式（monotonic / ticker）',
      args: [
        { key: 'Mode', label: '模式', type: 'select', options: ['monotonic', 'ticker'] },
        { key: 'IntervalMs', label: '间隔(ms)', type: 'number' },
      ],
      handler: async (ctx, a, s) => {
        s.runMode = a.Mode || 'monotonic'
        s.interval = a.IntervalMs || 1000
        return ok({ mode: s.runMode, intervalMs: s.interval })
      },
    },
  },
}

// ============================================================
// NetMapAbility（依赖 BaseData + NetMapData）
// ============================================================
export const NetMapAbility = {
  name: 'NetMapAbility',
  kind: 'ability',
  category: '基础',
  describe: 'NetMapAbility 提供对等节点拓扑管理：注册/更新/查询/移除对端，生成拓扑快照。',
  deps: ['BaseData', 'NetMapData'],
  initState: () => ({ peers: {} }),
  commands: {
    register_peer: {
      describe: '注册对等节点',
      args: [
        { key: 'Name', label: '节点名', type: 'string', required: true },
        { key: 'Address', label: '地址(host:port / IP / 主机名)', type: 'string', required: true },
        { key: 'Role', label: '角色', type: 'string' },
      ],
      handler: async (ctx, a, s) => {
        const name = String(a.Name || '').trim()
        const addr = String(a.Address || '').trim()
        if (!name) return fail(invalid('name empty'))
        if (!validPeerAddress(addr)) return fail(invalid(`address "${addr}" invalid`))
        if (s.peers[name]) return fail(invalid(`peer "${name}" already exists`))
        const peer = { name, address: addr, role: String(a.Role || '').trim(), lastSeen: Date.now() }
        s.peers[name] = peer
        return ok({ ...peer, lastSeen: new Date(peer.lastSeen).toISOString() })
      },
    },
    unregister_peer: {
      describe: '移除对等节点',
      args: [{ key: 'Name', label: '节点名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = String(a.Name || '').trim()
        if (!s.peers[name]) return fail(invalid(`peer "${name}" not found`))
        const prev = s.peers[name]
        delete s.peers[name]
        return ok({ ...prev, lastSeen: new Date(prev.lastSeen).toISOString() })
      },
    },
    update_peer: {
      describe: '更新对等节点（零值字段不更新）',
      args: [
        { key: 'Name', label: '节点名', type: 'string', required: true },
        { key: 'NewAddress', label: '新地址', type: 'string' },
        { key: 'NewRole', label: '新角色', type: 'string' },
      ],
      handler: async (ctx, a, s) => {
        const name = String(a.Name || '').trim()
        const peer = s.peers[name]
        if (!peer) return fail(invalid(`peer "${name}" not found`))
        if (a.NewAddress) {
          if (!validPeerAddress(String(a.NewAddress))) return fail(invalid('address invalid'))
          peer.address = String(a.NewAddress)
        }
        if (a.NewRole) peer.role = String(a.NewRole)
        peer.lastSeen = Date.now()
        return ok({ ...peer, lastSeen: new Date(peer.lastSeen).toISOString() })
      },
    },
    list_peers: {
      describe: '列出全部对等节点',
      args: [],
      handler: async (ctx, a, s) =>
        ok(Object.values(s.peers)
          .map((p) => ({ ...p, lastSeen: new Date(p.lastSeen).toISOString() }))
          .sort((x, y) => x.name.localeCompare(y.name))),
    },
    lookup_peer: {
      describe: '按名称或地址查找对等节点',
      args: [
        { key: 'Name', label: '节点名', type: 'string' },
        { key: 'Address', label: '地址', type: 'string' },
      ],
      handler: async (ctx, a, s) => {
        const name = String(a.Name || '').trim()
        const addr = String(a.Address || '').trim()
        if (name) {
          const p = s.peers[name]
          if (p) return ok({ ...p, lastSeen: new Date(p.lastSeen).toISOString() })
        }
        if (addr) {
          const p = Object.values(s.peers).find((x) => x.address === addr)
          if (p) return ok({ ...p, lastSeen: new Date(p.lastSeen).toISOString() })
        }
        return fail(invalid('peer not found'))
      },
    },
    get_topology: {
      describe: '生成 本节点 + 对等节点 拓扑快照',
      args: [],
      handler: async (ctx) => {
        const nd = ctx.node.data.NetMapData
        const self = {
          nodeName: nd.nodeName,
          defaultIface: nd.defaultIface,
          interfaces: JSON.parse(JSON.stringify(nd.interfaces)),
          hostAddresses: nd.interfaces.find((i) => i.name === nd.defaultIface)?.ipv4 || [],
          scannedAt: new Date(nd.scannedAt).toISOString(),
        }
        const peers = Object.values(ctx.state.peers)
          .map((p) => ({ ...p, lastSeen: new Date(p.lastSeen).toISOString() }))
          .sort((x, y) => x.name.localeCompare(y.name))
        return ok({ self, peers })
      },
    },
  },
}

// ============================================================
// OneKeyAbility（依赖 BaseData + NetMapData + KeyringData）
// ============================================================
// 注意：时间戳单位与主仓库 Go 版不同（Go 用 UnixNano，这里用 ms）。
// 本工具为离线模拟器，令牌仅在浏览器内签发/校验，不做跨仓库互通，故保留 ms 便于 UI 阅读。
export const OneKeyAbility = {
  name: 'OneKeyAbility',
  kind: 'ability',
  category: '基础',
  describe: 'OneKeyAbility 提供一键加密访问：为对等节点签发/校验/吊销 HMAC-SHA256 令牌。',
  deps: ['BaseData', 'NetMapData', 'KeyringData'],
  initState: () => ({}),
  commands: {
    issue_token: {
      describe: '为指定主题签发短期令牌',
      args: [
        { key: 'Subject', label: '主题(通常为对等节点名)', type: 'string', required: true },
        { key: 'TTL', label: 'TTL(秒)', type: 'number' },
      ],
      handler: async (ctx, a, s) => {
        const subject = String(a.Subject || '').trim()
        if (!subject) return fail(invalid('subject empty'))
        const kr = ctx.node.data.KeyringData
        // 显式负 TTL 报错；0/缺省使用默认
        if (a.TTL !== undefined && a.TTL !== null && a.TTL !== '' && Number(a.TTL) <= 0) {
          return fail(invalid('ttl must be positive'))
        }
        const ttlMs = (a.TTL !== undefined && a.TTL !== null && a.TTL !== '' && Number(a.TTL) > 0 ? Number(a.TTL) : 24 * 3600) * 1000
        // 复用 KeyringData 的签发逻辑
        const out = await krCommand(ctx, 'issue_token', { Subject: subject, TTL: ttlMs / 1000 })
        if (out.err) return fail(out.err)
        const tok = out.value
        const payload = `${tok.subject}|${tok.issuedAt}|${tok.expiresAt}`
        const sig = await hmacSignBase64Url(strToBytes(kr.secret), payload)
        return ok({
          Subject: tok.subject,
          IssuedAt: tok.issuedAt,
          ExpiresAt: tok.expiresAt,
          Signature: sig,
          encoded: `${tok.subject}.${tok.issuedAt}.${tok.expiresAt}.${sig}`,
        })
      },
    },
    verify_token: {
      describe: '校验令牌（签名 + 有效期 + 吊销状态）',
      args: [
        { key: 'Subject', label: '主题', type: 'string', required: true },
        { key: 'IssuedAt', label: '签发时间(unix ms)', type: 'number', required: true },
        { key: 'ExpiresAt', label: '过期时间(unix ms)', type: 'number', required: true },
        { key: 'Signature', label: '签名(base64url)', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        const kr = ctx.node.data.KeyringData
        const now = Date.now()
        if (a.ExpiresAt <= a.IssuedAt || a.ExpiresAt <= now || a.IssuedAt > now + 60 * 1000) {
          return fail(invalid('invalid token lifetime'))
        }
        const tok = kr.tokens[String(a.Subject).trim()]
        if (!tok) return fail(invalid('unknown subject'))
        if (tok.revoked) return fail(invalid('token revoked'))
        const payload = `${tok.subject}|${tok.issuedAt}|${tok.expiresAt}`
        const want = await hmacSignBase64Url(strToBytes(kr.secret), payload)
        if (want !== a.Signature) return fail(invalid('bad signature'))
        if (tok.issuedAt !== a.IssuedAt || tok.expiresAt !== a.ExpiresAt) return fail(invalid('token mismatch'))
        return ok(String(a.Subject).trim())
      },
    },
    revoke_token: {
      describe: '吊销指定主题令牌',
      args: [{ key: 'Subject', label: '主题', type: 'string', required: true }],
      handler: async (ctx, a) => {
        const out = await krCommand(ctx, 'revoke_token', { Subject: String(a.Subject).trim() })
        if (out.err) return fail(out.err)
        return ok(out.value)
      },
    },
    revoke_all: {
      describe: '吊销全部令牌',
      args: [],
      handler: async (ctx, a) => {
        const out = await krCommand(ctx, 'revoke_all', {})
        if (out.err) return fail(out.err)
        return ok(out.value)
      },
    },
    list_tokens: {
      describe: '列出本节点 Keyring 令牌',
      args: [],
      handler: async (ctx) => {
        const out = await krCommand(ctx, 'list_tokens', {})
        if (out.err) return fail(out.err)
        return ok(out.value)
      },
    },
    status: {
      describe: '查看密钥状态',
      args: [],
      handler: async (ctx) => {
        const out = await krCommand(ctx, 'status', {})
        if (out.err) return fail(out.err)
        return ok(out.value)
      },
    },
    rotate: {
      describe: '轮换共享密钥（旧令牌失效）',
      args: [],
      handler: async (ctx) => {
        const out = await krCommand(ctx, 'rotate', {})
        if (out.err) return fail(out.err)
        return ok(out.value)
      },
    },
  },
}

async function krCommand(ctx, act, args) {
  const kr = ctx.node.data.KeyringData
  const def = keyringCommands[act]
  if (!def) return { err: unsupported(act) }
  try {
    const res = await def.handler(ctx, args, kr)
    return res
  } catch (e) {
    return { err: String(e?.message || e) }
  }
}
