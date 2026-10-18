import { describe, expect, it } from 'vitest'
import { describeUnknownError, RoomError } from '../../shared/errors'

/**
 * 回归测试：Phase C.1 修复的 `[object Object]` bug。
 *
 * 真实根因（见 shared/errors.ts 的 describeUnknownError 文档注释和
 * frontend/src/lib/gameRoomDb.ts / gameEngineDb.ts 的 wrapDbCallError）：
 * `@cloudbase/js-sdk@3.10.2` 在某些失败路径下 reject 的是形如
 * `{code, message}` 的纯对象，不是 `Error` 实例；旧代码用
 * `err instanceof Error ? err.message : String(err)` 处理，
 * `String({code:'x', message:'y'})` 的结果就是字面量字符串
 * `"[object Object]"`，这组测试确保这种情况不会再发生。
 */
describe('describeUnknownError', () => {
  it('never produces the literal string "[object Object]" for a plain object error', () => {
    const result = describeUnknownError({ code: 'DATABASE_PERMISSION_DENIED', message: '没有权限' })
    expect(result).not.toBe('[object Object]')
    expect(result).toBe('没有权限')
  })

  it('extracts message from a CloudBase-style {code, message} rejection without a known code', () => {
    const result = describeUnknownError({ code: 'SOME_UNKNOWN_CODE', message: '网络请求失败' })
    expect(result).not.toBe('[object Object]')
    expect(result).toBe('网络请求失败')
  })

  it('looks up a known ErrorCode from a plain object even without an Error prototype', () => {
    const result = describeUnknownError({ code: 'ROOM_NOT_FOUND' })
    expect(result).toBe('房间不存在')
  })

  it('handles RoomError via the ERROR_MESSAGES_ZH table', () => {
    const result = describeUnknownError(new RoomError('NOT_YOUR_TURN'))
    expect(result).toBe('还没轮到你')
  })

  it('handles a plain Error instance', () => {
    const result = describeUnknownError(new Error('boom'))
    expect(result).toBe('boom')
  })

  it('handles a plain string', () => {
    expect(describeUnknownError('a plain string error')).toBe('a plain string error')
  })

  it('falls back to a safe message for a completely empty object, never "[object Object]"', () => {
    const result = describeUnknownError({})
    expect(result).not.toBe('[object Object]')
    expect(result.length).toBeGreaterThan(0)
  })

  it('falls back to a safe message for null/undefined', () => {
    expect(describeUnknownError(null)).not.toBe('[object Object]')
    expect(describeUnknownError(undefined)).not.toBe('[object Object]')
  })

  it('falls back to a safe message for exotic values (number, array)', () => {
    expect(describeUnknownError(42)).not.toBe('[object Object]')
    expect(describeUnknownError([1, 2, 3])).not.toBe('[object Object]')
  })
})
