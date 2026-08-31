import { ALL, componentDef } from './registry/index.js'

// CommandOutput 与 FasterEdge types.CommandOutput 对齐：{Name, Value, Err}
export function makeOutput(name, value, err) {
  return { Name: name, Value: err === null || err === undefined ? value : null, Err: err || null }
}

// 校验并转换参数；返回 {ok, value} 或 {ok:false, err}
function validateArgs(argDefs, raw) {
  const out = {}
  const src = raw && typeof raw === 'object' ? raw : {}
  for (const def of argDefs || []) {
    let v = src[def.key]
    const has = v !== undefined && v !== null && v !== ''
    if (!has && def.required) {
      return { ok: false, err: `missing required argument "${def.label || def.key}"` }
    }
    if (!has) {
      if (def.default !== undefined) out[def.key] = def.default
      continue
    }
    switch (def.type) {
      case 'number': {
        const n = Number(v)
        if (v !== '' && Number.isNaN(n)) return { ok: false, err: `argument "${def.key}" must be a number` }
        out[def.key] = n
        break
      }
      case 'bool': {
        out[def.key] = v === true || v === 'true' || v === 1 || v === '1'
        break
      }
      case 'json': {
        if (typeof v === 'string') {
          try {
            v = JSON.parse(v)
          } catch (e) {
            return { ok: false, err: `argument "${def.key}" invalid JSON: ${e.message}` }
          }
        }
        out[def.key] = v
        break
      }
      case 'select': {
        out[def.key] = String(v)
        break
      }
      default:
        out[def.key] = String(v)
    }
  }
  return { ok: true, value: out }
}

// 执行命令：Command(nodeId, component, act, args) -> CommandOutput
export async function runCommand(world, nodeId, component, act, args, opts = {}) {
  const node = world.nodes.find((n) => n.id === nodeId)
  if (!node) return makeOutput(act, null, `atom is nil (node "${nodeId}" not found)`)
  const def = componentDef(component)
  if (!def) return makeOutput(act, null, `component "${component}" not registered`)

  const isData = def.kind === 'data'
  const state = isData ? node.data[component] : node.abilities[component]
  if (state === undefined) {
    return makeOutput(act, null, `component "${component}" not mounted on node "${node.name}"`)
  }

  // 依赖检查（Ability 依赖的 Data 必须在场）
  for (const dep of def.deps || []) {
    const depDef = componentDef(dep)
    const present = depDef && depDef.kind === 'data' ? node.data[dep] !== undefined : node.abilities[dep] !== undefined
    if (!present) {
      return makeOutput(act, null, `component dependency is missing: ${dep} (add "${dep}" to node "${node.name}")`)
    }
  }

  const cmdDef = def.commands?.[act]
  if (!cmdDef) return makeOutput(act, null, `unsupported command: ${act} on ${component}`)

  const checked = validateArgs(cmdDef.args, args)
  if (!checked.ok) return makeOutput(act, null, `invalid command arguments: ${checked.err}`)

  const ctx = {
    world,
    node,
    state,
    component,
    act,
    data: node.data,
    abilities: node.abilities,
  }
  try {
    const res = (await cmdDef.handler(ctx, checked.value, state)) || {}
    if (res && res.__skipLog === undefined) {
      world.logCommand({
        nodeId,
        nodeName: node.name,
        component,
        act,
        args: checked.value,
        value: res.value ?? null,
        err: res.err ?? null,
      })
    }
    return makeOutput(act, res.value, res.err)
  } catch (e) {
    const err = `panic: ${e && e.message ? e.message : e}`
    world.logCommand({ nodeId, nodeName: node.name, component, act, args: checked.value, value: null, err })
    return makeOutput(act, null, err)
  }
}

// 给 UI 用的命令列表（含参数 schema）
export function commandSchema(def) {
  const out = []
  for (const [name, cmd] of Object.entries(def.commands || {})) {
    out.push({ name, describe: cmd.describe || '', args: cmd.args || [] })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}