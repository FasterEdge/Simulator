// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
import { ok, fail, invalid, unsupported } from '../errors.js'
import { randomToken } from '../crypto.js'
import { topologyPath } from '../world.js'
import { trimStr } from '../netpolicy.js'

// 对齐主仓库 isValidAbsoluteRemotePath：远端路径必须以 "/" 开头、
// 无 ".." 段、无 Windows 反斜杠分隔符（防远端写路径穿越）
function validRemotePath(p) {
  const s = String(p ?? '')
  if (!s || !s.startsWith('/')) return false
  if (s.includes(String.fromCharCode(92))) return false
  return s.split('/').every((seg) => seg !== '..')
}

// 对齐主仓库 isValidAlgDistComponent：≤128，仅 [a-zA-Z0-9._-]
function validComponentName(s) {
  const v = String(s ?? '')
  if (!v || v.length > 128) return false
  return /^[a-zA-Z0-9._-]+$/.test(v)
}

// 简易 Shell：模拟常用命令输出，支持节点虚拟文件系统
function simulateShell(node, cmdline) {
  const parts = cmdline.split(/\s+/).filter(Boolean)
  if (!parts.length) return { exitCode: 0, stdout: '' }
  const [cmd, ...rest] = parts
  const fs = node.fs || {}
  switch (cmd) {
    case 'echo':
      return { exitCode: 0, stdout: rest.join(' ') + '\n' }
    case 'hostname':
      return { exitCode: 0, stdout: node.name + '\n' }
    case 'uname':
      return { exitCode: 0, stdout: (rest.includes('-a') ? 'Linux fasteredge 5.15.0-sim x86_64 GNU/Linux' : 'Linux') + '\n' }
    case 'pwd':
      return { exitCode: 0, stdout: '/root\n' }
    case 'whoami':
      return { exitCode: 0, stdout: 'fasteredge\n' }
    case 'id':
      return { exitCode: 0, stdout: 'uid=0(root) gid=0(root) groups=0(root)\n' }
    case 'ls': {
      const dir = rest.find((x) => !x.startsWith('-')) || '/'
      const names = Object.keys(fs).filter((p) => p.startsWith(dir === '/' ? '/' : dir)).map((p) => p.split('/').pop())
      return { exitCode: 0, stdout: [...new Set(names)].join('  ') + '\n' }
    }
    case 'cat': {
      const file = rest.find((x) => !x.startsWith('-'))
      if (!file || !(file in fs)) return { exitCode: 1, stdout: '', stderr: `cat: ${file}: No such file or directory\n` }
      return { exitCode: 0, stdout: fs[file] + '\n' }
    }
    case 'date':
      return { exitCode: 0, stdout: new Date().toString() + '\n' }
    case 'printenv':
      return { exitCode: 0, stdout: `NODE_NAME=${node.name}\nROLE=${node.role || ''}\n` }
    case 'true':
      return { exitCode: 0, stdout: '' }
    case 'false':
      return { exitCode: 1, stdout: '', stderr: '' }
    default:
      return { exitCode: 127, stdout: '', stderr: `sh: command not found: ${cmd}\n` }
  }
}

// ============================================================
// CmdAbility（模拟进程表 + allowlist）
// ============================================================
// 模拟 Shell 支持的常用命令（默认白名单，开箱可用；set_allowlist 可收紧，[] 表示拒绝一切）
const DEFAULT_ALLOWLIST = ['echo', 'hostname', 'uname', 'pwd', 'whoami', 'id', 'ls', 'cat', 'date', 'printenv', 'true', 'false']

function makeCmdAbility(name, describe, wrapper) {
  return {
    name,
    kind: 'ability',
    category: '终端',
    describe,
    deps: ['BaseData'],
    initState: () => ({ jobs: {}, allowlist: [...DEFAULT_ALLOWLIST], allowAny: false, seq: 1 }),
    commands: {
      run: {
        describe: '运行命令并等待结果',
        args: [{ key: 'Command', label: '命令', type: 'string', required: true }],
        handler: async (ctx, a, s) => {
          const cmd = String(a.Command || '').trim()
          if (!cmd) return fail(invalid('command empty'))
          const allowed = s.allowAny === true || checkAllowlist(s.allowlist, cmd)
          if (!allowed) return fail(invalid(`command not allowed by allowlist: ${cmd}`))
          const line = wrapper ? `${wrapper} "${cmd}"` : cmd
          const res = simulateShell(ctx.node, cmd)
          return ok({ command: line, exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr || '' })
        },
      },
      start: {
        describe: '后台启动命令',
        args: [{ key: 'Command', label: '命令', type: 'string', required: true }],
        handler: async (ctx, a, s) => {
          const cmd = String(a.Command || '').trim()
          if (!cmd) return fail(invalid('command empty'))
          const allowed = s.allowAny === true || checkAllowlist(s.allowlist, cmd)
          if (!allowed) return fail(invalid(`command not allowed by allowlist: ${cmd}`))
          const id = `job-${s.seq++}`
          const res = simulateShell(ctx.node, cmd)
          s.jobs[id] = {
            id,
            command: cmd,
            status: res.exitCode === 0 ? 'exited' : 'failed',
            exitCode: res.exitCode,
            startedAt: Date.now(),
            finishedAt: Date.now(),
            output: res.stdout,
            error: res.stderr || '',
          }
          return ok({ id, status: s.jobs[id].status, exitCode: res.exitCode })
        },
      },
      wait: {
        describe: '等待后台任务完成',
        args: [{ key: 'Id', label: '任务 ID', type: 'string', required: true }],
        handler: async (ctx, a, s) => {
          const job = s.jobs[a.Id]
          if (!job) return fail(invalid(`job "${a.Id}" not found`))
          return ok({ id: job.id, status: job.status, exitCode: job.exitCode })
        },
      },
      kill: {
        describe: '终止后台任务',
        args: [{ key: 'Id', label: '任务 ID', type: 'string', required: true }],
        handler: async (ctx, a, s) => {
          const job = s.jobs[a.Id]
          if (!job) return fail(invalid(`job "${a.Id}" not found`))
          job.status = 'killed'
          job.finishedAt = Date.now()
          return ok({ id: job.id, status: 'killed' })
        },
      },
      list: {
        describe: '列出全部任务',
        args: [],
        handler: async (ctx, a, s) =>
          ok(Object.values(s.jobs).map((j) => ({ ...j, startedAt: new Date(j.startedAt).toISOString(), finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null }))),
      },
      get_job: {
        describe: '获取单个任务详情',
        args: [{ key: 'Id', label: '任务 ID', type: 'string', required: true }],
        handler: async (ctx, a, s) => {
          const job = s.jobs[a.Id]
          if (!job) return fail(invalid(`job "${a.Id}" not found`))
          return ok({ ...job, startedAt: new Date(job.startedAt).toISOString(), finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null })
        },
      },
      clear_finished: {
        describe: '清理已完成任务',
        args: [],
        handler: async (ctx, a, s) => {
          let n = 0
          for (const k of Object.keys(s.jobs)) {
            if (s.jobs[k].status !== 'running') { delete s.jobs[k]; n++ }
          }
          return ok(n)
        },
      },
      set_allowlist: {
        describe: '设置命令白名单（JSON 数组，支持前缀匹配）',
        args: [{ key: 'Commands', label: '白名单数组', type: 'json' }],
        handler: async (ctx, a, s) => {
          s.allowlist = Array.isArray(a.Commands) ? a.Commands.map(String) : []
          // 对齐主仓库 SetAllowlist：显式设表即退出"允许任意"模式
          s.allowAny = false
          return ok([...s.allowlist])
        },
      },
      // 对齐主仓库 CmdCommandSetAllowAny / ShCommandSetAllowAny /
      // BashCommandSetAllowAny：白名单为空时 fail-closed 拒绝一切执行，
      // 必须显式 opt-in 才能全放行（主仓库把"空表=放行"当授权洞修掉了）。
      set_allowlist_any: {
        describe: '显式打开/关闭"允许任意命令"（opt-in，关闭时清空白名单）',
        args: [{ key: 'Any', label: '是否放行任意命令', type: 'bool', required: true }],
        handler: async (ctx, a, s) => {
          s.allowAny = a.Any === true || a.Any === 'true' || a.Any === 1 || a.Any === '1'
          if (!s.allowAny) s.allowlist = []
          return ok(s.allowAny)
        },
      },
      get_allowlist: {
        describe: '获取命令白名单',
        args: [],
        handler: async (ctx, a, s) => ok([...s.allowlist]),
      },
    },
  }
}

function checkAllowlist(allowlist, cmd) {
  // 空表 = 拒绝一切（对齐 Go：未配置即未授权）
  if (!allowlist || !allowlist.length) return false
  const tokens = cmd.split(/\s+/).filter(Boolean)
  if (!tokens.length) return false
  return allowlist.some((entry) => {
    const et = String(entry).trim().split(/\s+/).filter(Boolean)
    if (!et.length) return false
    // 逐 token 精确匹配（entry 作为命令前缀模式），避免 ls 放行 lsblk
    for (let i = 0; i < et.length; i++) {
      if (i >= tokens.length || tokens[i] !== et[i]) return false
    }
    return true
  })
}

export const CmdAbility = makeCmdAbility('CmdAbility', 'CmdAbility 提供命令执行能力（模拟 Shell + 进程表 + 可插拔白名单）。')
export const ShAbility = makeCmdAbility('ShAbility', 'ShAbility 基于 CmdAbility，以 sh -c 形式执行命令。', 'sh -c')
export const BashAbility = makeCmdAbility('BashAbility', 'BashAbility 基于 ShAbility，以 bash --noprofile --norc -c 形式执行命令。', 'bash --noprofile --norc -c')

// ============================================================
// ConfigFileAbility（基于 ConfigData 的 JSON 持久化）
// ============================================================
export const ConfigFileAbility = {
  name: 'ConfigFileAbility',
  kind: 'ability',
  category: '文件/配置',
  describe: 'ConfigFileAbility 基于 ConfigData 提供 JSON 配置文件的加载/保存（虚拟文件系统）。',
  deps: ['BaseData', 'ConfigData'],
  initState: () => ({ path: '/etc/fasteredge/config.json' }),
  commands: {
    set_path: {
      describe: '设置配置文件路径',
      args: [{ key: 'Path', label: '路径', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const p = String(a.Path || '').trim()
        if (!p) return fail(invalid('path empty'))
        s.path = p
        return ok(s.path)
      },
    },
    get_path: {
      describe: '获取配置文件路径',
      args: [],
      handler: async (ctx, a, s) => ok(s.path),
    },
    load: {
      describe: '从虚拟文件系统加载 JSON 到 ConfigData',
      args: [],
      handler: async (ctx, a, s) => {
        const fs = ctx.node.fs || {}
        if (!(s.path in fs)) return fail(invalid(`file "${s.path}" not found`))
        try {
          const data = JSON.parse(fs[s.path])
          ctx.node.data.ConfigData.values = data
          return ok({ path: s.path, keys: Object.keys(data).length })
        } catch (e) {
          return fail(invalid('invalid JSON in file: ' + e.message))
        }
      },
    },
    save: {
      describe: '把 ConfigData 快照保存为 JSON 到虚拟文件系统',
      args: [],
      handler: async (ctx, a, s) => {
        const values = JSON.parse(JSON.stringify(ctx.node.data.ConfigData.values || {}))
        if (!ctx.node.fs) ctx.node.fs = {}
        ctx.node.fs[s.path] = JSON.stringify(values, null, 2)
        return ok({ path: s.path, keys: Object.keys(values).length })
      },
    },
    exists: {
      describe: '检查配置文件是否存在',
      args: [],
      handler: async (ctx, a, s) => ok(Boolean(ctx.node.fs && ctx.node.fs[s.path])),
    },
  },
}

// ============================================================
// FileTransferAbility（可插拔 Transport，模拟跨节点虚拟 FS）
// ============================================================
export const FileTransferAbility = {
  name: 'FileTransferAbility',
  kind: 'ability',
  category: '文件/配置',
  describe: 'FileTransferAbility 提供文件上传/下载/列表/取消能力，目标由 Transport 模拟。',
  deps: ['BaseData', 'NetMapData', 'NetMapAbility'],
  initState: () => ({ target: '', transfers: {}, seq: 1 }),
  commands: {
    set_target: {
      describe: '设置目标节点（须能在拓扑中解析到）',
      args: [{ key: 'Address', label: '目标节点', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 set_target：PeerName 必填且必须能解析为拓扑中的对端
        const t = trimStr(a.Address)
        if (!t) return fail(invalid('target empty'))
        if (!resolveTarget(ctx, t)) return fail(invalid(`target "${t}" not found in topology`))
        s.target = t
        return ok(s.target)
      },
    },
    get_target: {
      describe: '获取目标节点地址',
      args: [],
      handler: async (ctx, a, s) => ok(s.target),
    },
    upload: {
      describe: '上传文件到目标节点（写入目标虚拟 FS；要求拓扑连通）',
      args: [
        { key: 'RemotePath', label: '远端路径', type: 'string', required: true },
        { key: 'Content', label: '内容', type: 'textarea' },
      ],
      handler: async (ctx, a, s) => {
        const resolved = resolveReachableTarget(ctx, s, s.target)
        if (resolved.err) return fail(invalid(resolved.err))
        // 对齐主仓库 upload：remote 路径必须绝对且无 ".." 段
        const remote = String(a.RemotePath ?? '')
        if (!validRemotePath(remote)) return fail(invalid('remote path must be absolute without traversal'))
        const target = resolved.target
        const id = `ft-${s.seq++}`
        if (!target.fs) target.fs = {}
        target.fs[remote] = String(a.Content || '')
        const now = ctx.world.clock.now()
        s.transfers[id] = {
          id,
          direction: 'upload',
          remotePath: remote,
          target: s.target,
          hops: resolved.path.length - 1,
          status: 'completed',
          progress: 100,
          createdAt: now,
          completedAt: now,
        }
        return ok({
          id, remotePath: remote, target: s.target,
          hops: resolved.path.length - 1, path: resolved.path, status: 'completed',
        })
      },
    },
    download: {
      describe: '从目标节点下载文件（要求拓扑连通）',
      args: [{ key: 'RemotePath', label: '远端路径', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const resolved = resolveReachableTarget(ctx, s, s.target)
        if (resolved.err) return fail(invalid(resolved.err))
        // 对齐主仓库 download：remote 路径必须绝对且无 ".." 段
        const remote = String(a.RemotePath ?? '')
        if (!validRemotePath(remote)) return fail(invalid('remote path must be absolute without traversal'))
        const target = resolved.target
        if (!target.fs || !(remote in target.fs)) return fail(invalid(`remote file "${remote}" not found`))
        return ok({ remotePath: remote, content: target.fs[remote], hops: resolved.path.length - 1 })
      },
    },
    check_link: {
      describe: '检查到目标的拓扑连通性（返回路径与跳数，不连通则报错）',
      args: [{ key: 'Target', label: '目标节点（默认用 set_target 的值）', type: 'string' }],
      handler: async (ctx, a, s) => {
        const want = a.Target ? String(a.Target).trim() : s.target
        const resolved = resolveReachableTarget(ctx, s, want)
        if (resolved.err) return fail(invalid(resolved.err))
        return ok({ target: resolved.target.name, hops: resolved.path.length - 1, path: resolved.path, connected: true })
      },
    },
    list: {
      describe: '列出全部传输记录',
      args: [],
      handler: async (ctx, a, s) =>
        ok(Object.values(s.transfers).map((t) => ({ ...t, createdAt: new Date(t.createdAt).toISOString(), completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null }))),
    },
    get_transfer: {
      describe: '获取传输记录详情',
      args: [{ key: 'Id', label: '传输 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库：ID trim 后非空
        const id = trimStr(a.Id)
        if (!id) return fail(invalid('transfer id empty'))
        const t = s.transfers[id]
        if (!t) return fail(invalid(`transfer "${id}" not found`))
        return ok({ ...t, createdAt: new Date(t.createdAt).toISOString(), completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null })
      },
    },
    cancel: {
      describe: '取消传输',
      args: [{ key: 'Id', label: '传输 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const id = trimStr(a.Id)
        if (!id) return fail(invalid('transfer id empty'))
        const t = s.transfers[id]
        if (!t) return fail(invalid(`transfer "${id}" not found`))
        t.status = 'canceled'
        return ok({ id: t.id, status: 'canceled' })
      },
    },
    clear_finished: {
      describe: '清理已完成/已取消记录',
      args: [],
      handler: async (ctx, a, s) => {
        let n = 0
        for (const k of Object.keys(s.transfers)) {
          if (s.transfers[k].status !== 'in_progress') { delete s.transfers[k]; n++ }
        }
        return ok(n)
      },
    },
  },
}

function resolveTarget(ctx, target) {
  const nodes = ctx.world?.nodes || []
  if (!target) return null
  for (const n of nodes) {
    if (n.id === target || n.name === target) return n
  }
  for (const n of nodes) {
    const nmd = n.data?.NetMapData
    if (nmd) {
      if (nmd.nodeName === target) return n
      for (const iface of nmd.interfaces || []) {
        if (iface.ipv4.includes(target)) return n
      }
    }
  }
  return null
}

// 拓扑连通性约束：目标节点必须能通过 world.links 从源节点到达。
// 返回 { target, path } 或 { err }，错误文案带上两端与"未连线"原因，便于论文里做可复现的失败案例。
function resolveReachableTarget(ctx, s, target) {
  const t = resolveTarget(ctx, target)
  if (!t) return { err: `target "${target || ''}" not found in topology` }
  const path = topologyPath(ctx.world, ctx.node.id, t.id)
  if (!path) {
    return { err: `no link path from "${ctx.node.name}" to "${t.name}" in topology (add a link between them first)` }
  }
  return { target: t, path }
}

// ============================================================
// AlgorithmDistributionAbility（基于 FileTransfer 的算法分发）
// ============================================================
export const AlgorithmDistributionAbility = {
  name: 'AlgorithmDistributionAbility',
  kind: 'ability',
  category: '文件/配置',
  describe: 'AlgorithmDistributionAbility 注册并分发算法到目标节点（模拟）。',
  deps: ['BaseData', 'NetMapData', 'FileTransferAbility'],
  initState: () => ({ algorithms: {}, distributions: {}, seq: 1 }),
  commands: {
    register_algorithm: {
      describe: '注册算法（name/version 均必填）',
      args: [
        { key: 'Name', label: '算法名', type: 'string', required: true },
        { key: 'Version', label: '版本', type: 'string', required: true },
        { key: 'Payload', label: '算法内容', type: 'textarea' },
      ],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 register_algorithm：name/version 均必填且走字符白名单
        // （旧实现 version 缺省回落 'v1'，与 Go 的"version 必填"不一致）
        const name = trimStr(a.Name)
        const version = trimStr(a.Version)
        if (!name || !version) return fail(invalid('name/version/source required'))
        if (!validComponentName(name) || !validComponentName(version)) {
          return fail(invalid(`invalid algorithm name/version "${name}"/"${version}"`))
        }
        s.algorithms[name] = { name, version, payload: String(a.Payload || '') }
        return ok(s.algorithms[name])
      },
    },
    unregister_algorithm: {
      describe: '注销算法',
      args: [{ key: 'Name', label: '算法名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        if (!name) return fail(invalid('name empty'))
        if (!s.algorithms[name]) return fail(invalid(`algorithm "${name}" not found`))
        const alg = s.algorithms[name]
        delete s.algorithms[name]
        return ok(alg)
      },
    },
    list_algorithms: {
      describe: '列出全部算法',
      args: [],
      handler: async (ctx, a, s) => ok(Object.values(s.algorithms)),
    },
    get_algorithm: {
      describe: '获取算法详情',
      args: [{ key: 'Name', label: '算法名', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const name = trimStr(a.Name)
        if (!name) return fail(invalid('name empty'))
        const alg = s.algorithms[name]
        if (!alg) return fail(invalid('algorithm not found'))
        return ok(alg)
      },
    },
    distribute: {
      describe: '分发算法到目标节点（要求拓扑连通）',
      args: [
        { key: 'Algorithm', label: '算法名', type: 'string', required: true },
        { key: 'Target', label: '目标节点', type: 'string', required: true },
      ],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 distribute：name/version/target 均必填
        const algName = trimStr(a.Algorithm)
        if (!algName) return fail(invalid('algorithm name empty'))
        const alg = s.algorithms[algName]
        if (!alg) return fail(invalid('algorithm not found'))
        const wantTarget = trimStr(a.Target)
        if (!wantTarget) return fail(invalid('target empty'))
        const resolved = resolveReachableTarget(ctx, s, wantTarget)
        if (resolved.err) return fail(invalid(resolved.err))
        const target = resolved.target
        if (!target.fs) target.fs = {}
        const id = `ad-${s.seq++}`
        const path = `/algorithms/${alg.name}-${alg.version}.json`
        target.fs[path] = JSON.stringify(alg)
        const now = ctx.world.clock.now()
        s.distributions[id] = {
          id, algorithm: alg.name, target: wantTarget, path, status: 'completed', createdAt: now, completedAt: now,
        }
        return ok({ id, algorithm: alg.name, target: wantTarget, path, hops: resolved.path.length - 1, status: 'completed' })
      },
    },
    cancel: {
      describe: '取消分发',
      args: [{ key: 'Id', label: '分发 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const id = trimStr(a.Id)
        if (!id) return fail(invalid('distribution id empty'))
        const d = s.distributions[id]
        if (!d) return fail(invalid(`distribution "${id}" not found`))
        d.status = 'canceled'
        return ok({ id: d.id, status: 'canceled' })
      },
    },
    list_distributions: {
      describe: '列出全部分发记录',
      args: [],
      handler: async (ctx, a, s) =>
        ok(Object.values(s.distributions).map((d) => ({ ...d, createdAt: new Date(d.createdAt).toISOString(), completedAt: d.completedAt ? new Date(d.completedAt).toISOString() : null }))),
    },
    clear_finished: {
      describe: '清理已完成的记录',
      args: [],
      handler: async (ctx, a, s) => {
        let n = 0
        for (const k of Object.keys(s.distributions)) {
          if (s.distributions[k].status !== 'in_progress') { delete s.distributions[k]; n++ }
        }
        return ok(n)
      },
    },
  },
}
