import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomError } from '../../../shared/errors'
import { getDocOrNull, wrapDbError } from '../src/lib/db-errors'

describe('getDocOrNull', () => {
  it('resolve 且有数据时返回文档', async () => {
    const doc = await getDocOrNull(
      async () => ({ data: [{ _id: '1', name: 'a' }] }),
      (res) => res.data[0],
      'ctx',
    )
    expect(doc).toEqual({ _id: '1', name: 'a' })
  })

  it('resolve 但 data 为空数组时返回 null（覆盖"resolve 空结果"这种可能性）', async () => {
    const doc = await getDocOrNull(
      async () => ({ data: [] }),
      (res) => res.data[0],
      'ctx',
    )
    expect(doc).toBeNull()
  })

  it('抛出带 DOCUMENT_NOT_FOUND 字样的异常时返回 null（覆盖"reject 异常"这种可能性）', async () => {
    const doc = await getDocOrNull(
      async () => {
        throw new Error('DOCUMENT_NOT_FOUND: no such document')
      },
      (res: { data: unknown[] }) => res.data[0],
      'ctx',
    )
    expect(doc).toBeNull()
  })

  it('抛出带 404 字样的异常时也返回 null', async () => {
    const doc = await getDocOrNull(
      async () => {
        throw new Error('request failed with status 404')
      },
      (res: { data: unknown[] }) => res.data[0],
      'ctx',
    )
    expect(doc).toBeNull()
  })

  it('抛出看起来不是"文档不存在"的异常时，不吞掉，包装成 RoomError INTERNAL_ERROR 抛出', async () => {
    await expect(
      getDocOrNull(
        async () => {
          throw new Error('DATABASE_PERMISSION_DENIED')
        },
        (res: { data: unknown[] }) => res.data[0],
        'getRoomById(x)',
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }))
  })

  it('抛给调用方的 RoomError.message 是通用安全提示，不包含原始错误/上下文（客户端不应看到实现细节）', async () => {
    try {
      await getDocOrNull(
        async () => {
          throw new Error('INVALID_CREDENTIALS: Credentials are invalid.')
        },
        (res: { data: unknown[] }) => res.data[0],
        'getRoomByCode(123456)',
      )
      expect.unreachable('应该抛出异常')
    } catch (error) {
      expect(error).toBeInstanceOf(RoomError)
      const roomError = error as RoomError
      // 客户端能看到的 message：通用提示，不包含原始错误文本或调用上下文。
      expect(roomError.message).not.toContain('getRoomByCode')
      expect(roomError.message).not.toContain('INVALID_CREDENTIALS')
      expect(roomError.message).not.toContain('Credentials are invalid')
      // 完整诊断信息放在 internalDetail，这个字段不会被 toApiError() 序列化。
      expect(roomError.internalDetail).toContain('getRoomByCode(123456)')
      expect(roomError.internalDetail).toContain('INVALID_CREDENTIALS')
      expect(roomError.toApiError()).not.toHaveProperty('internalDetail')
    }
  })
})

describe('wrapDbError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // wrapDbError 会 console.error 完整诊断信息——这是故意的（服务端日志
    // 需要看到真实原因），但测试输出不需要被这些日志刷屏，所以 mock 掉，
    // 同时验证它确实被调用了（诊断信息真的进了日志，不是被默默丢弃）。
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('把普通 Error 包装成 RoomError(INTERNAL_ERROR)，客户端 message 是通用提示', () => {
    const wrapped = wrapDbError(new Error('boom'), 'myContext')
    expect(wrapped).toBeInstanceOf(RoomError)
    expect(wrapped.code).toBe('INTERNAL_ERROR')
    // message 面向客户端：不包含原始错误文本和调用上下文。
    expect(wrapped.message).not.toContain('myContext')
    expect(wrapped.message).not.toContain('boom')
  })

  it('完整诊断信息（上下文 + 原始错误）放进 internalDetail，不是 message', () => {
    const wrapped = wrapDbError(new Error('boom'), 'myContext')
    expect(wrapped.internalDetail).toContain('myContext')
    expect(wrapped.internalDetail).toContain('boom')
  })

  it('完整诊断信息会被 console.error 记录，方便从服务端日志排查', () => {
    wrapDbError(new Error('boom'), 'myContext')
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const loggedText = consoleErrorSpy.mock.calls[0]?.[0] as string
    expect(loggedText).toContain('myContext')
    expect(loggedText).toContain('boom')
  })

  it('toApiError() 不会泄漏 internalDetail 给客户端', () => {
    const wrapped = wrapDbError(new Error('INVALID_CREDENTIALS'), 'getRoomByCode')
    const apiError = wrapped.toApiError()
    expect(apiError).toEqual({ code: 'INTERNAL_ERROR', message: wrapped.message })
    expect(JSON.stringify(apiError)).not.toContain('INVALID_CREDENTIALS')
    expect(JSON.stringify(apiError)).not.toContain('getRoomByCode')
  })

  it('能处理非 Error 类型的 throw（比如字符串）', () => {
    const wrapped = wrapDbError('something went wrong', 'ctx')
    expect(wrapped.code).toBe('INTERNAL_ERROR')
    expect(wrapped.internalDetail).toContain('something went wrong')
  })
})
