// 与 FasterEdge types/errors.go 对应的模拟错误常量
export const ErrText = {
  NilAtom: 'atom is nil',
  NilComponent: 'component is nil',
  InvalidComponentName: 'component name is empty or invalid',
  DuplicateComponent: 'component name is already registered',
  InvalidArguments: 'invalid command arguments',
  UnsupportedCommand: 'unsupported command',
  MissingDependency: 'component dependency is missing',
  WrongDependencyType: 'component dependency has wrong type',
  NotMounted: 'component is not mounted',
  AuthenticationRequired: 'command authentication is required',
  AuthenticationFailed: 'command authentication failed',
  InvalidAddress: 'invalid address',
  NotFound: 'not found',
}

export class SimError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SimError'
  }
}

export const fail = (msg) => ({ err: msg })
export const ok = (value) => ({ value })

export const invalid = (extra) => (extra ? `${ErrText.InvalidArguments}: ${extra}` : ErrText.InvalidArguments)
export const unsupported = (act) => `${act}: ${ErrText.UnsupportedCommand}`
export const missingDep = (name) => `${ErrText.MissingDependency}: ${name}`