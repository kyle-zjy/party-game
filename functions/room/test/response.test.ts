import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomError } from '../../../shared/errors'
import { err, ok } from '../src/lib/response'

describe('ok', () => {
  it('包装成功结果', () => {
    expect(ok({ foo: 'bar' })).toEqual({ ok: true, data: { foo: 'bar' } })
  })
})

describe('err', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('RoomError 直接转成客户端安全形状', () => {
    const result = err(new RoomError('NOT_MEMBER', '你还不是这个房间的成员'))
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_MEMBER', message: '你还不是这个房间的成员' },
    })
  })

  it('带 internalDetail 的 RoomError：客户端收不到 internalDetail，但会记一条日志', () => {
    const roomError = new RoomError(
      'INTERNAL_ERROR',
      '服务器内部错误，请稍后重试',
      '数据库操作失败（getRoomByCode）：INVALID_CREDENTIALS',
    )
    const result = err(roomError)
    expect(result.error.message).toBe('服务器内部错误，请稍后重试')
    expect(JSON.stringify(result)).not.toContain('INVALID_CREDENTIALS')
    expect(consoleErrorSpy).toHaveBeenCalled()
    const logged = consoleErrorSpy.mock.calls[0]?.[0] as string
    expect(logged).toContain('INVALID_CREDENTIALS')
  })

  it('任意非 RoomError 异常：不泄漏原始错误文本，统一返回 INTERNAL_ERROR + 通用提示', () => {
    const result = err(new Error('ENOTFOUND some.internal.hostname'))
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误，请稍后重试' },
    })
    expect(JSON.stringify(result)).not.toContain('ENOTFOUND')
    expect(JSON.stringify(result)).not.toContain('internal.hostname')
  })

  it('非 Error 类型的 throw（比如字符串、对象）也不会泄漏到客户端', () => {
    const result = err('raw string with SECRET_LOOKING_VALUE')
    expect(result.error.message).toBe('服务器内部错误，请稍后重试')
    expect(JSON.stringify(result)).not.toContain('SECRET_LOOKING_VALUE')
  })

  it('非 RoomError 异常仍然会把完整内容记到服务端日志，方便排查', () => {
    err(new Error('ENOTFOUND some.internal.hostname'))
    expect(consoleErrorSpy).toHaveBeenCalled()
    const logged = consoleErrorSpy.mock.calls[0]?.[0] as string
    expect(logged).toContain('ENOTFOUND')
  })
})
