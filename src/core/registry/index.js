import { dataCatalog } from './data.js'
import {
  BaseAbility,
  RoleAbility,
  CloudRoleAbility,
  EdgeRoleAbility,
  TimeAbility,
  NetMapAbility,
  OneKeyAbility,
} from './ability-core.js'
import {
  CmdAbility,
  ShAbility,
  BashAbility,
  ConfigFileAbility,
  FileTransferAbility,
  AlgorithmDistributionAbility,
} from './ability-terminal.js'
import { ModbusAbility, SerialAbility, TSNAbility } from './ability-industrial.js'
import {
  MQTTAbility,
  InfluxDBAbility,
  EKuiperAbility,
  DockerAbility,
  KubernetesAbility,
} from './ability-external.js'

export const DATA = { ...dataCatalog }

export const ABILITIES = {
  BaseAbility,
  RoleAbility,
  CloudRoleAbility,
  EdgeRoleAbility,
  TimeAbility,
  NetMapAbility,
  OneKeyAbility,
  CmdAbility,
  ShAbility,
  BashAbility,
  ConfigFileAbility,
  FileTransferAbility,
  AlgorithmDistributionAbility,
  ModbusAbility,
  SerialAbility,
  TSNAbility,
  MQTTAbility,
  InfluxDBAbility,
  EKuiperAbility,
  DockerAbility,
  KubernetesAbility,
}

export const ALL = { ...DATA, ...ABILITIES }

export function componentDef(name) {
  return ALL[name] || null
}

export const CATEGORIES = ['基础', '数据库', '终端', '工业协议', '文件/配置', '数据交互', '容器编排']

// 节点模板：预置组件组合（对照 README 的 InitStandardAtom / 常见边缘云组合）
export const TEMPLATES = {
  standard: {
    name: 'standard',
    label: '标准 Atom',
    icon: '⚙️',
    color: '#3b82f6',
    describe: '对照 FasterEdge InitStandardAtom：Base/NetMap/Keyring/Config/Time/OneKey/Cmd/Sh/Bash/ConfigFile 全套基础组件。',
    data: ['BaseData', 'NetMapData', 'KeyringData', 'ConfigData'],
    abilities: ['BaseAbility', 'RoleAbility', 'TimeAbility', 'NetMapAbility', 'OneKeyAbility', 'CmdAbility', 'ShAbility', 'BashAbility', 'ConfigFileAbility'],
  },
  cloud: {
    name: 'cloud',
    label: '云端节点',
    icon: '☁️',
    color: '#8b5cf6',
    describe: '标准组件 + CloudRoleAbility，角色预设为 cloud，适合作为云控制面。',
    data: ['BaseData', 'NetMapData', 'KeyringData', 'ConfigData'],
    abilities: ['BaseAbility', 'RoleAbility', 'TimeAbility', 'NetMapAbility', 'OneKeyAbility', 'CmdAbility', 'ShAbility', 'BashAbility', 'ConfigFileAbility', 'CloudRoleAbility', 'MQTTAbility'],
    presetRole: 'cloud',
  },
  edge: {
    name: 'edge',
    label: '边缘节点',
    icon: '📡',
    color: '#10b981',
    describe: '标准组件 + EdgeRoleAbility + FileTransfer + Modbus + Serial，角色预设为 edge，适合边缘计算。',
    data: ['BaseData', 'NetMapData', 'KeyringData', 'ConfigData', 'MySQLData', 'InfluxDBData'],
    abilities: ['BaseAbility', 'RoleAbility', 'TimeAbility', 'NetMapAbility', 'OneKeyAbility', 'CmdAbility', 'ShAbility', 'BashAbility', 'ConfigFileAbility', 'EdgeRoleAbility', 'FileTransferAbility', 'AlgorithmDistributionAbility', 'MQTTAbility', 'ModbusAbility', 'SerialAbility', 'InfluxDBAbility'],
    presetRole: 'edge',
  },
  sensor: {
    name: 'sensor',
    label: '传感器节点',
    icon: '🌡️',
    color: '#f59e0b',
    describe: '轻量采集节点：Modbus/Serial/TSN + MQTT 上报，角色预设为 edge。',
    data: ['BaseData', 'NetMapData', 'ConfigData', 'InfluxDBData'],
    abilities: ['BaseAbility', 'RoleAbility', 'TimeAbility', 'NetMapAbility', 'ModbusAbility', 'SerialAbility', 'TSNAbility', 'MQTTAbility', 'InfluxDBAbility'],
    presetRole: 'edge',
  },
  db: {
    name: 'db',
    label: '数据库节点',
    icon: '🗄️',
    color: '#ef4444',
    describe: '承载 MySQL/PostgreSQL/SQLite/Redis/MongoDB/InfluxDB Data 与容器编排能力。',
    data: ['BaseData', 'ConfigData', 'MySQLData', 'PostgreSQLData', 'SQLiteData', 'RedisData', 'MongoDBData', 'InfluxDBData'],
    abilities: ['BaseAbility', 'RoleAbility', 'TimeAbility', 'NetMapAbility', 'MQTTAbility', 'InfluxDBAbility', 'DockerAbility', 'KubernetesAbility', 'EKuiperAbility'],
    presetRole: 'db',
  },
  custom: {
    name: 'custom',
    label: '自定义 Atom',
    icon: '🧩',
    color: '#64748b',
    describe: '只含 BaseData + BaseAbility 的最小骨架，按需手动添加 Data / Ability。',
    data: ['BaseData'],
    abilities: ['BaseAbility'],
  },
}

export const TEMPLATE_LIST = Object.values(TEMPLATES)