// FasterEdge 开源项目 - Github: https://github.com/FasterEdge - Gitee: https://gitee.com/FasterEdge
import { ok, fail, invalid } from '../errors.js'
import { trimStr, splitHostPort, isDialableHost, isIpLiteral, isAcceptableHostname, stripBrackets } from '../netpolicy.js'

// Modbus 读写单次上限（对齐主仓库：读 1..125 寄存器、写 1..123 寄存器）
const MODBUS_MAX_READ = 125
const MODBUS_MAX_WRITE = 123

// 对齐主仓库 isValidModbusEndpoint：host:port（TCP）或 /dev/...:baud:format（RTU）
function validModbusEndpoint(addr) {
  const s = trimStr(addr)
  if (!s) return false
  if (s.startsWith('/')) {
    const parts = s.split(':')
    if (parts.length !== 3) return false
    if (!parts[1] || !/^\d+$/.test(parts[1])) return false
    const f = parts[2]
    if (!f || f.length < 2 || f.length > 9) return false
    return /^[0-9A-Za-z]+$/.test(f)
  }
  const hp = splitHostPort(s)
  if (!hp) return false
  if (isIpLiteral(hp.host)) return isDialableHost(hp.host, { allowPrivate: true })
  return isAcceptableHostname(hp.host)
}

// 对齐主仓库 isValidSerialPort：/dev/tty* 或 COM+数字
function validSerialPort(port) {
  const p = trimStr(port)
  if (!p) return false
  if (p.startsWith('/dev/tty')) return true
  const upper = p.toUpperCase()
  if (upper.startsWith('COM') && upper.length > 3) return /^\d+$/.test(upper.slice(3))
  return false
}

// UI 用 none/even/odd 标签，存储用主仓库的 N/O/E 单字母
function normalizeParity(value) {
  switch (String(value || '').trim().toLowerCase()) {
    case 'n': case 'none': return 'n'
    case 'o': case 'odd': return 'o'
    case 'e': case 'even': return 'e'
    default: return String(value || '')
  }
}

// 对齐主仓库 isValidSerialConfig：波特率白名单、DataBits 5..8、StopBits 1..2、Parity N/O/E
const SERIAL_BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]
function validSerialConfig(cfg) {
  if (!SERIAL_BAUDS.includes(Number(cfg.baud))) return false
  const dataBits = Number(cfg.dataBits)
  if (![5, 6, 7, 8].includes(dataBits)) return false
  const stopBits = Number(cfg.stopBits)
  if (![1, 2].includes(stopBits)) return false
  return ['n', 'o', 'e'].includes(normalizeParity(cfg.parity))
}

const MAX_SERIAL_READ_BYTES = 1 << 20

// TSN 优先级/队列上限（802.1Q 8 个流量类别）
const TSN_MAX_PRIORITY = 7

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
      describe: '设置端点（host:port 或 /dev/ttyUSB0:9600:8N1）',
      args: [{ key: 'Endpoint', label: '端点', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        const ep = trimStr(a.Endpoint)
        if (!validModbusEndpoint(ep)) return fail(invalid(`invalid endpoint "${ep}"`))
        s.endpoint = ep
        return ok(s.endpoint)
      },
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
      handler: async (ctx, a, s) => readReg(s.holding, a.Start, a.Count),
    },
    read_input: {
      describe: '读取输入寄存器',
      args: [
        { key: 'Start', label: '起始地址', type: 'number', required: true },
        { key: 'Count', label: '数量', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => readReg(s.input, a.Start, a.Count),
    },
    read_coils: {
      describe: '读取线圈',
      args: [
        { key: 'Start', label: '起始地址', type: 'number', required: true },
        { key: 'Count', label: '数量', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => readReg(s.coils, a.Start, a.Count),
    },
    read_discrete: {
      describe: '读取离散输入',
      args: [
        { key: 'Start', label: '起始地址', type: 'number', required: true },
        { key: 'Count', label: '数量', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => readReg(s.discrete, a.Start, a.Count),
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
        // 对齐主仓库：Values 长度必须 1..123
        if (values.length < 1 || values.length > MODBUS_MAX_WRITE) {
          return fail(invalid(`values must be 1-${MODBUS_MAX_WRITE} items`))
        }
        const start = Number(a.Address)
        if (!Number.isInteger(start) || start < 0) return fail(invalid('address must be a non-negative integer'))
        values.forEach((v, i) => { s.holding[start + i] = Number(v) })
        return ok(values.length)
      },
    },
  },
}

// 对齐主仓库 read_* 校验：Quantity 必须 1..125（0 或 >125 一律 ErrInvalidArguments）
function sliceReg(arr, start, count) {
  const c = Number(count)
  if (!Number.isInteger(c) || c < 1 || c > MODBUS_MAX_READ) return null
  const s = Number(start)
  if (!Number.isInteger(s) || s < 0) return null
  return arr.slice(s, s + c)
}

function readReg(arr, start, count) {
  const out = sliceReg(arr, start, count)
  if (out === null) return fail(invalid(`quantity must be 1-${MODBUS_MAX_READ}`))
  return ok(out)
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
    config: { baud: 9600, dataBits: 8, stopBits: 1, parity: 'n' },
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
        const port = trimStr(a.Port) || s.ports[0] || ''
        // 对齐主仓库：端口必须 /dev/tty* 或 COM+数字
        if (!validSerialPort(port)) return fail(invalid(`invalid port "${port}"`))
        // 对齐主仓库：重复打开同一端口拒绝
        if (s.opened && s.port === port) return fail(invalid(`port "${port}" already open`))
        if (!validSerialConfig(s.config)) return fail(invalid('invalid config'))
        s.port = port
        s.opened = true
        return ok({ port: s.port, config: { ...s.config } })
      },
    },
    close: {
      describe: '关闭串口',
      args: [],
      handler: async (ctx, a, s) => {
        // 对齐主仓库：未打开时 close 拒绝
        if (!s.opened) return fail(invalid(`port "${s.port}" not open`))
        s.opened = false
        return ok('closed')
      },
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
        const data = String(a.Data ?? '')
        // 对齐主仓库：数据非空且端口已打开
        if (!data) return fail(invalid('data empty'))
        if (!s.opened) return fail(invalid('port not open'))
        s.buffer += data
        return ok(data.length)
      },
    },
    read: {
      describe: '读取串口缓冲',
      args: [{ key: 'Size', label: '最多字节数', type: 'number' }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库：Length 必须 >0 且 ≤1MiB
        const hasSize = a.Size !== undefined && a.Size !== null && a.Size !== ''
        const size = hasSize ? Number(a.Size) : s.buffer.length
        if (hasSize && (!Number.isInteger(size) || size <= 0 || size > MAX_SERIAL_READ_BYTES)) {
          return fail(invalid(`length must be 1-${MAX_SERIAL_READ_BYTES}`))
        }
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
        { key: 'StopBits', label: '停止位', type: 'number' },
        { key: 'Parity', label: '校验', type: 'select', options: ['none', 'even', 'odd'] },
      ],
      handler: async (ctx, a, s) => {
        const next = { ...s.config }
        if (a.Baud !== undefined && a.Baud !== null && a.Baud !== '') next.baud = Number(a.Baud)
        if (a.DataBits !== undefined && a.DataBits !== null && a.DataBits !== '') next.dataBits = Number(a.DataBits)
        if (a.StopBits !== undefined && a.StopBits !== null && a.StopBits !== '') next.stopBits = Number(a.StopBits)
        if (a.Parity) next.parity = normalizeParity(a.Parity)
        // 对齐主仓库：波特率白名单、DataBits 5..8、StopBits 1..2、Parity N/O/E
        if (!validSerialConfig(next)) return fail(invalid('invalid config'))
        s.config = next
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
      handler: async (ctx, a, s) => {
        // 对齐主仓库：trim 后必须非空
        const iface = trimStr(a.Iface)
        if (!iface) return fail(invalid('interface empty'))
        s.iface = iface
        return ok(s.iface)
      },
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
        { key: 'Priority', label: '优先级(0-7)', type: 'number', required: true },
        { key: 'Interval', label: '发送间隔(ms)', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 register_talker：id 必填且唯一、priority ≤ 7、interval > 0
        const id = trimStr(a.StreamId)
        if (!id) return fail(invalid('stream id empty'))
        if (s.streams[id] || s.talkers[id]) return fail(invalid(`stream "${id}" already exists`))
        const priority = Number(a.Priority)
        if (!Number.isInteger(priority) || priority < 0 || priority > TSN_MAX_PRIORITY) {
          return fail(invalid(`priority must be 0-${TSN_MAX_PRIORITY}`))
        }
        const interval = Number(a.Interval)
        if (!Number.isInteger(interval) || interval <= 0) return fail(invalid('interval must be positive'))
        const t = { streamId: id, vlan: Number(a.Vlan), priority, interval, registeredAt: Date.now() }
        s.talkers[id] = t
        s.streams[id] = { streamId: id, vlan: t.vlan, priority: t.priority, talker: s.iface, listeners: [] }
        return ok(s.streams[id])
      },
    },
    register_listener: {
      describe: '注册 Listener',
      args: [
        { key: 'StreamId', label: '流 ID', type: 'string', required: true },
        { key: 'Priority', label: '优先级(0-7)', type: 'number', required: true },
      ],
      handler: async (ctx, a, s) => {
        // 对齐主仓库 register_listener：id 必填、流必须已注册、priority ≤ 7
        const id = trimStr(a.StreamId)
        if (!id) return fail(invalid('stream id empty'))
        const priority = Number(a.Priority)
        if (!Number.isInteger(priority) || priority < 0 || priority > TSN_MAX_PRIORITY) {
          return fail(invalid(`priority must be 0-${TSN_MAX_PRIORITY}`))
        }
        if (!s.streams[id]) return fail(invalid(`stream "${id}" not registered`))
        if (!s.listeners[id]) s.listeners[id] = { streamId: id, iface: s.iface, priority, registeredAt: Date.now() }
        if (!s.streams[id].listeners.includes(s.iface)) s.streams[id].listeners.push(s.iface)
        return ok(s.listeners[id])
      },
    },
    unregister: {
      describe: '注销流',
      args: [{ key: 'StreamId', label: '流 ID', type: 'string', required: true }],
      handler: async (ctx, a, s) => {
        // 对齐主仓库：id 必填，不存在则拒绝（旧实现静默返回 dropped: []）
        const id = trimStr(a.StreamId)
        if (!id) return fail(invalid('stream id empty'))
        if (!s.streams[id] && !s.talkers[id] && !s.listeners[id]) {
          return fail(invalid(`stream "${id}" not found`))
        }
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
      describe: '设置优先级映射（JSON 对象：priority -> queue，均 0-7）',
      args: [{ key: 'Map', label: '映射对象', type: 'json', required: true }],
      handler: async (ctx, a, s) => {
        const map = a.Map
        if (!map || typeof map !== 'object' || Array.isArray(map)) return fail(invalid('map must be an object'))
        // 对齐主仓库 set_priority_map：key 与 value 都必须 ≤ 7
        for (const [p, q] of Object.entries(map)) {
          const pk = Number(p)
          const qk = Number(q)
          if (!Number.isInteger(pk) || pk < 0 || pk > TSN_MAX_PRIORITY) {
            return fail(invalid(`priority ${p} out of range`))
          }
          if (!Number.isInteger(qk) || qk < 0 || qk > TSN_MAX_PRIORITY) {
            return fail(invalid(`queue ${q} out of range`))
          }
        }
        s.priorityMap = {}
        for (const [p, q] of Object.entries(map)) s.priorityMap[Number(p)] = Number(q)
        return ok(JSON.parse(JSON.stringify(s.priorityMap)))
      },
    },
    get_priority_map: {
      describe: '获取优先级映射',
      args: [],
      handler: async (ctx, a, s) => ok(JSON.parse(JSON.stringify(s.priorityMap))),
    },
    set_time_aware: {
      describe: '设置时间感知调度（JSON 数组，元素数 1..16）',
      args: [{ key: 'Schedule', label: '调度数组', type: 'json', required: true }],
      handler: async (ctx, a, s) => {
        const arr = a.Schedule
        if (!Array.isArray(arr)) return fail(invalid('schedule must be an array'))
        // 对齐主仓库 set_time_aware：GateStates 长度必须 1..16
        if (arr.length < 1 || arr.length > 16) return fail(invalid('gate states must be 1-16 items'))
        s.timeAware = JSON.parse(JSON.stringify(arr))
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
