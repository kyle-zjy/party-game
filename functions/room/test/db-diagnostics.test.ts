import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logDbDiagnostic } from '../src/lib/db-diagnostics'

/**
 * 测试对象是真实踩过的坑本身的分类逻辑：五个 CloudBase 官方错误码
 * （MISSING_CREDENTIALS/INVALID_CREDENTIALS/DATABASE_PERMISSION_DENIED/
 * DATABASE_COLLECTION_NOT_EXIST/DATABASE_REQUEST_FAILED）必须被严格区分，
 * 不能用字符串模糊匹配混在一起。
 *
 * MISSING_CREDENTIALS 和 INVALID_CREDENTIALS 这两个场景的 error.code 是
 * 用本机直接对真实 CloudBase 环境发起请求实测确认的（见
 * db-diagnostics.ts 文件头注释），不是编出来的测试数据。
 */
describe('logDbDiagnostic', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('MISSING_CREDENTIALS：实测对真实环境不传任何凭证时的错误码', () => {
    const error = Object.assign(new Error('Credentials missing.'), { code: 'MISSING_CREDENTIALS' })
    const entry = logDbDiagnostic('test-op', error)
    expect(entry.classification).toBe('MISSING_CREDENTIALS')
    expect(entry.errorCode).toBe('MISSING_CREDENTIALS')
  })

  it('INVALID_CREDENTIALS：实测对真实环境传入格式正确但无效的 secretId/secretKey 时的错误码', () => {
    const error = Object.assign(new Error('Credentials are invalid.'), { code: 'INVALID_CREDENTIALS' })
    const entry = logDbDiagnostic('test-op', error)
    expect(entry.classification).toBe('INVALID_CREDENTIALS')
  })

  it('DATABASE_PERMISSION_DENIED 和 INVALID_CREDENTIALS 必须被区分开，不能混淆', () => {
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'DATABASE_PERMISSION_DENIED',
    })
    const credentialsError = Object.assign(new Error('invalid'), { code: 'INVALID_CREDENTIALS' })
    expect(logDbDiagnostic('op', permissionError).classification).toBe('DATABASE_PERMISSION_DENIED')
    expect(logDbDiagnostic('op', credentialsError).classification).toBe('INVALID_CREDENTIALS')
  })

  it('DATABASE_COLLECTION_NOT_EXIST 被正确分类', () => {
    const error = Object.assign(new Error('collection does not exist'), {
      code: 'DATABASE_COLLECTION_NOT_EXIST',
    })
    expect(logDbDiagnostic('op', error).classification).toBe('DATABASE_COLLECTION_NOT_EXIST')
  })

  it('DATABASE_REQUEST_FAILED 被正确分类', () => {
    const error = Object.assign(new Error('generic db failure'), {
      code: 'DATABASE_REQUEST_FAILED',
    })
    expect(logDbDiagnostic('op', error).classification).toBe('DATABASE_REQUEST_FAILED')
  })

  it('未知的 error.code 分类为 UNKNOWN，不会被强行塞进某个已知分类', () => {
    const error = Object.assign(new Error('something else'), { code: 'SOME_OTHER_CODE' })
    expect(logDbDiagnostic('op', error).classification).toBe('UNKNOWN')
  })

  it('没有 code 字段的普通 Error 也分类为 UNKNOWN', () => {
    const entry = logDbDiagnostic('op', new Error('plain error'))
    expect(entry.classification).toBe('UNKNOWN')
    expect(entry.errorCode).toBe('UNKNOWN')
  })

  it('非 Error 类型的 throw 也能被处理，不会抛出二次异常', () => {
    expect(() => logDbDiagnostic('op', 'raw string error')).not.toThrow()
    const entry = logDbDiagnostic('op', 'raw string error')
    expect(entry.errorMessage).toBe('raw string error')
  })

  it('记录的诊断信息包含 operation/errorName/errorCode/classification/message/stackPreview', () => {
    const error = Object.assign(new Error('boom'), { code: 'INVALID_CREDENTIALS' })
    const entry = logDbDiagnostic('checkDbConnectivity:rooms.count()', error)
    expect(entry.operation).toBe('checkDbConnectivity:rooms.count()')
    expect(entry.errorName).toBe('Error')
    expect(entry.errorMessage).toBe('boom')
    expect(entry.stackPreview).toBeDefined()
  })

  it('会把诊断信息 console.error 出来，方便从服务端日志查看', () => {
    logDbDiagnostic('op', Object.assign(new Error('boom'), { code: 'INVALID_CREDENTIALS' }))
    expect(consoleErrorSpy).toHaveBeenCalled()
    const loggedArgs = consoleErrorSpy.mock.calls[0]
    expect(loggedArgs?.[0]).toBe('[db-diagnostic]')
    const loggedJson = JSON.parse(loggedArgs?.[1] as string)
    expect(loggedJson.classification).toBe('INVALID_CREDENTIALS')
  })

  it('堆栈预览不包含完整堆栈（只截断前几行），不会把整条路径刷屏', () => {
    const error = new Error('boom')
    error.stack = Array.from({ length: 20 }, (_, i) => `at frame${i} (/path/to/file.js:${i}:1)`).join(
      '\n',
    )
    const entry = logDbDiagnostic('op', error)
    const lineCount = entry.stackPreview?.split('\n').length ?? 0
    expect(lineCount).toBeLessThan(20)
  })

  it('不会在诊断日志里出现任何看起来像凭证的字符串（这个测试本身只是防呆，不代表穷举所有可能）', () => {
    const error = Object.assign(new Error('Credentials are invalid.'), { code: 'INVALID_CREDENTIALS' })
    const entry = logDbDiagnostic('op', error)
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('AKID')
    expect(serialized).not.toContain('secretKey')
    expect(serialized).not.toContain('Authorization')
  })
})
