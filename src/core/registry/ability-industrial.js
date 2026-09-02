// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
import { ok, fail, invalid } from '../errors.js'

// ============================================================
// ModbusAbility（模拟寄存器表）
// ============================================================
export const ModbusAbility = {
  name: 'ModbusAbility',
  kind: 'ability',
  category: '工业协议',
  describe: 'ModbusAbility 提供 Modbus TCP/RTU 读写能力：保持寄存器、输入寄存器、线圈、离散量（全部离线模拟）。',
  deps: ['BaseData'],
  initState: () => ({
    endpoint: 'tcp://127.0.0.1:5020',
    unitId: 1,
    holding: Array(64).fill(0),
    input: Array(64).fill(0),
    coils: Array(64).fill(false),
    discrete: Array(64).fill(false),
  }),
  commands: {
    set_endpoint: {
      describe: '设置端点',
      args: [{ key: 'Endpoint', label: '端点', type: 'string', required: true }],
      handler: async (ctx, a, s) => { s.endpoint = String(a.Endpoint).trim(); return ok(s.endpoint) },
    },
    get_endpoint: {
      describe: '获取端点',
      args: [],
      handler: async (ctx, a, s) => ok(s.endpoint),
    },
    set_unit_id: {
      describe: '设置单元 ID',
      args: [{ key: 'UnitID', label: '单元 ID', type: 'number', required: true }],
      handler: async (ctx, a, s) => { s.unitId = Number(a.UnitID); return ok(s.unitId) },
    },
    get_unit_id: {
      describe: '获取单元 ID',
      args: [],
      handler: async (ctx, a, s) => ok(s.unitId),
    },
    read_holding: {
      describe: '读取保持寄存器',
      args: [
        { key: 'Start', label: '起始地址', type: 'number', required: true },
        { key: 'Count', label: '数量', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => ok(sliceReg(s.holding, a.Start, a.Count)),
    },
    read_input: {
      describe: '读取输入寄存器',
      args: [
        { key: 'Start', label: '起始地址', type: 'number', required: true },
        { key: 'Count', label: '数量', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => ok(sliceReg(s.input, a.Start, a.Count)),
    },
    read_coils: {
      describe: '读取线圈',
      args: [
        { key: 'Start', label: '起始地址', type: 'number', required: true },
        { key: 'Count', label: '数量', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => ok(sliceReg(s.coils, a.Start, a.Count)),
    },
    read_discrete: {
      describe: '读取离散输入',
      args: [
        { key: 'Start', label: '起始地址', type: 'number', required: true },
        { key: 'Count', label: '数量', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => ok(sliceReg(s.discrete, a.Start, a.Count)),
    },
    write_holding: {
      describe: '写单个保持寄存器',
      args: [
        { key: 'Address', label: '地址', type: 'number', required: true },
        { key: 'Value', label: '值', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => { s.holding[Number(a.Address)] = Number(a.Value); return ok(s.holding[a.Address]) },
    },
    write_coil: {
      describe: '写单个线圈',
      args: [
        { key: 'Address', label: '地址', type: 'number', required: true },
        { key: 'Value', label: '值', type: 'bool', required: true },
      ],
      handler: async (ctx, a, s) => { s.coils[Number(a.Address)] = Boolean(a.Value); return ok(s.coils[a.Address]) },
    },
    write_holding_multi: {
      describe: '写多个保持寄存器（值数组）',
      args: [
        { key: 'Address', label: '起始地址', type: 'number', required: true },
        { key: 'Values', label: '值数组', type: 'json', required: true },
      ],
      handler: async (ctx, a, s) => {
        const values = Array.isArray(a.Values) ? a.Values : []
        values.forEach((v, i) => { s.holding[Number(a.Address) + i] = Number(v) })
        return ok(values.length)
      },
    },
  },
}

function sliceReg(arr, start, count) {
  const s = Number(start)
  const c = Number(count)
  if (s < 0 || c <= 0) return []
  return arr.slice(s, s + c)
}

// ============================================================
// SerialAbility（模拟串口缓冲）
// ============================================================
export const SerialAbility = {
  name: 'SerialAbility',
  kind: 'ability',
  category: '工业协议',
  describe: 'SerialAbility 提供串口读写能力：打开/关闭/读/写/配置/端口列表（全部离线模拟）。',
  deps: ['BaseData'],
  initState: () => ({
    ports: ['/dev/ttyUSB0', '/dev/ttyS0', '/dev/ttyAMA0'],
    port: '',
    opened: false,
    config: { baud: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
    buffer: '',
  }),
  commands: {
    list_ports: {
      describe: '列出可用串口',
      args: [],
      handler: async (ctx, a, s) => ok([...s.ports]),
    },
    open: {
      describe: '打开串口',
      args: [{ key: 'Port', label: '端口名', type: 'string' }],
      handler: async (ctx, a, s) => {
        const port = String(a.Port || s.ports[0] || '').trim()
        if (!port) return fail(invalid('port empty'))
        s.port = port
        s.opened = true
        return ok({ port: s.port, config: { ...s.config } })
      },
    },
    close: {
      describe: '关闭串口',
      args: [],
      handler: async (ctx, a, s) => { s.opened = false; return ok('closed') },
    },
    is_open: {
      describe: '查询是否打开',
      args: [],
      handler: async (ctx, a, s) => ok(s.opened),
    },
    write: {
      describe: '写入串口',
      args: [{ key: 'Data', label: '数据', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        if (!s.opened) return fail(invalid('port not open'))
        s.buffer += String(a.Data || '')
        return ok(String(a.Data || '').length)
      },
    },
    read: {
      describe: '读取串口缓冲',
      args: [{ key: 'Size', label: '最多字节数', type: 'number' }],
      handler: async (ctx, a, s) => {
        const size = a.Size ? Number(a.Size) : s.buffer.length
        const out = s.buffer.slice(0, size)
        s.buffer = s.buffer.slice(size)
        return ok(out)
      },
    },
    set_config: {
      describe: '设置串口参数',
      args: [
        { key: 'Baud', label: '波特率', type: 'number' },
        { key: 'DataBits', label: '数据位', type: 'number' },
        { key: 'Parity', label: '校验', type: 'select', options: ['none', 'even', 'odd'] },
      ],
      handler: async (ctx, a, s) => {
        s.config.baud = a.Baud ? Number(a.Baud) : s.config.baud
        s.config.dataBits = a.DataBits ? Number(a.DataBits) : s.config.dataBits
        if (a.Parity) s.config.parity = String(a.Parity)
        return ok({ ...s.config })
      },
    },
    get_config: {
      describe: '获取串口参数',
      args: [],
      handler: async (ctx, a, s) => ok({ ...s.config }),
    },
  },
}

// ============================================================
// TSNAbility（模拟 TSN 流表）
// ============================================================
export const TSNAbility = {
  name: 'TSNAbility',
  kind: 'ability',
  category: '工业协议',
  describe: 'TSNAbility 提供 TSN 流管理：注册 Talker/Listener、优先级映射、时间感知调度（模拟）。',
  deps: ['BaseData'],
  initState: () => ({
    iface: 'eth0',
    talkers: {},
    listeners: {},
    streams: {},
    priorityMap: {},
    timeAware: [],
  }),
  commands: {
    set_interface: {
      describe: '设置网络接口',
      args: [{ key: 'Iface', label: '接口', type: 'string', required: true }],
      handler: async (ctx, a, s) => { s.iface = String(a.Iface).trim(); return ok(s.iface) },
    },
    get_interface: {
      describe: '获取网络接口',
      args: [],
      handler: async (ctx, a, s) => ok(s.iface),
    },
    register_talker: {
      describe: '注册 Talker',
      args: [
        { key: 'StreamId', label: '流 ID', type: 'string', required: true },
        { key: 'Vlan', label: 'VLAN', type: 'number', required: true },
        { key: 'Priority', label: '优先级', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => {
        const id = String(a.StreamId).trim()
        const t = { streamId: id, vlan: Number(a.Vlan), priority: Number(a.Priority), registeredAt: Date.now() }
        s.talkers[id] = t
        if (!s.streams[id]) s.streams[id] = { streamId: id, vlan: t.vlan, priority: t.priority, talker: s.iface, listeners: [] }
        return ok(s.streams[id])
      },
    },
    register_listener: {
      describe: '注册 Listener',
      args: [{ key: 'StreamId', label: '流 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const id = String(a.StreamId).trim()
        if (!s.streams[id]) return fail(invalid(`stream "${id}" not registered`))
        if (!s.listeners[id]) s.listeners[id] = { streamId: id, iface: s.iface, registeredAt: Date.now() }
        if (!s.streams[id].listeners.includes(s.iface)) s.streams[id].listeners.push(s.iface)
        return ok(s.listeners[id])
      },
    },
    unregister: {
      describe: '注销流',
      args: [{ key: 'StreamId', label: '流 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const id = String(a.StreamId).trim()
        const dropped = []
        if (s.talkers[id]) { delete s.talkers[id]; dropped.push('talker') }
        if (s.listeners[id]) { delete s.listeners[id]; dropped.push('listener') }
        if (s.streams[id]) { delete s.streams[id]; dropped.push('stream') }
        return ok({ streamId: id, dropped })
      },
    },
    list_streams: {
      describe: '列出全部流',
      args: [],
      handler: async (ctx, a, s) => ok(Object.values(s.streams)),
    },
    set_priority_map: {
      describe: '设置优先级映射（JSON 对象）',
      args: [{ key: 'Map', label: '映射对象', type: 'json' }],
      handler: async (ctx, a, s) => {
        s.priorityMap = a.Map && typeof a.Map === 'object' ? a.Map : {}
        return ok(JSON.parse(JSON.stringify(s.priorityMap)))
      },
    },
    get_priority_map: {
      describe: '获取优先级映射',
      args: [],
      handler: async (ctx, a, s) => ok(JSON.parse(JSON.stringify(s.priorityMap))),
    },
    set_time_aware: {
      describe: '设置时间感知调度（JSON 数组）',
      args: [{ key: 'Schedule', label: '调度数组', type: 'json' }],
      handler: async (ctx, a, s) => {
        s.timeAware = Array.isArray(a.Schedule) ? a.Schedule : []
        return ok(JSON.parse(JSON.stringify(s.timeAware)))
      },
    },
    get_time_aware: {
      describe: '获取时间感知调度',
      args: [],
      handler: async (ctx, a, s) => ok(JSON.parse(JSON.stringify(s.timeAware))),
    },
  },
}
