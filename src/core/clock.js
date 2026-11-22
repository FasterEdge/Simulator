// ─────────────────────────────────────────────────────────────
// FasterEdge 开源项目
// Github: https://github.com/FasterEdge
// Gitee:  https://gitee.com/FasterEdge
// ─────────────────────────────────────────────────────────────

// 世界时钟（模拟时钟）：把系统时间线性映射为可推进 / 可快进的模拟时间。
// 状态模型：world = anchorWorld + (real - anchorReal) * scale（frozen 时 world = anchorWorld）
// - advance(ms)    手动推进：虚拟时间瞬时前跳（时间旅行式复现）
// - setScale(x)    快进倍率：x 倍速流逝（x > 1 快进，x < 1 慢放，x = 0 停走）
// - setOffset(ms)  固定偏移：让模拟时间相对系统时间偏移 ms（与 TimeAbility.sync_manual 对齐）
// - setFrozen(x)   冻结：模拟时间停止流逝，解冻后从冻结时刻继续
// 锚点放在闭包里而非对象字段，避免 reactive 代理干扰，也避免把内部锚点写进序列化结果。
export function createClock(world) {
  let anchorReal = Date.now()
  let anchorWorld = anchorReal
  let offsetMs = typeof world?.clockOffsetMs === 'number' ? world.clockOffsetMs : 0
  let advanceMs = 0
  let scale = 1
  let frozen = false

  const now = () => (frozen ? anchorWorld : anchorWorld + (Date.now() - anchorReal) * scale)
  const rebase = (worldMs) => {
    anchorReal = Date.now()
    anchorWorld = worldMs
  }
  const finite = (v, label) => {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`clock: ${label} must be a finite number`)
    return n
  }

  const clock = {
    now,
    nowIso: () => new Date(now()).toISOString(),
    get offsetMs() {
      return offsetMs
    },
    get advanceMs() {
      return advanceMs
    },
    get scale() {
      return scale
    },
    get frozen() {
      return frozen
    },
    // 模拟时间与系统时间的瞬时差（含倍率漂移与手动推进量）
    driftMs: () => now() - Date.now(),
    snapshot() {
      return { offsetMs, advanceMs, scale, frozen, time: new Date(now()).toISOString() }
    },
    setOffset(ms) {
      const n = finite(ms, 'offset')
      const delta = n - offsetMs
      offsetMs = n
      if (world) world.clockOffsetMs = n
      rebase(now() + delta)
      return clock.snapshot()
    },
    advance(ms) {
      const n = finite(ms, 'advance')
      advanceMs += n
      rebase(now() + n)
      return clock.snapshot()
    },
    setScale(x) {
      const n = finite(x, 'scale')
      if (n < 0) throw new Error('clock: scale must be >= 0')
      const w = now()
      scale = n
      rebase(w)
      return clock.snapshot()
    },
    setFrozen(flag) {
      const want = Boolean(flag)
      if (want === frozen) return clock.snapshot()
      const w = now()
      frozen = want
      rebase(w)
      return clock.snapshot()
    },
    reset() {
      offsetMs = 0
      advanceMs = 0
      scale = 1
      frozen = false
      if (world) world.clockOffsetMs = 0
      rebase(Date.now())
      return clock.snapshot()
    },
    // 设定绝对模拟时间（TimeAbility.sync_manual）：推进量清零，offset 反映绝对时间
    setAbsolute(ms) {
      const n = finite(ms, 'time')
      const delta = n - now()
      offsetMs += delta
      advanceMs = 0
      if (world) world.clockOffsetMs = offsetMs
      rebase(n)
      return clock.snapshot()
    },
    // 与系统时间对齐（TimeAbility.sync_system）：只清零偏移与推进量，保留倍率/冻结配置
    alignSystem() {
      offsetMs = 0
      advanceMs = 0
      if (world) world.clockOffsetMs = 0
      rebase(Date.now())
      return clock.snapshot()
    },
    // hydrate 用：按持久化快照重建锚点，使推进量与倍率不丢失
    restore(snap) {
      const s = snap && typeof snap === 'object' ? snap : {}
      offsetMs = Number.isFinite(Number(s.offsetMs)) ? Number(s.offsetMs) : 0
      advanceMs = Number.isFinite(Number(s.advanceMs)) ? Number(s.advanceMs) : 0
      scale = Number.isFinite(Number(s.scale)) && Number(s.scale) >= 0 ? Number(s.scale) : 1
      frozen = Boolean(s.frozen)
      if (world) world.clockOffsetMs = offsetMs
      rebase(Date.now() + offsetMs + advanceMs)
      return clock.snapshot()
    },
  }
  return clock
}
