/**
 * 数据库连通性诊断——专供 `devDbHealthCheck` 使用，不用于正常业务路径
 * （正常的 `db.ts` 读写用 `db-errors.ts` 的通用包装，不需要这么详细的分类）。
 *
 * ## 错误码对照表（已用真实网络请求对照 CloudBase 服务确认，不是凭空列的）
 *
 * 用本机直接对真实的 `party-game-d5g0uxms1b4a800c7` 环境发起数据库请求
 * （只是本地脚本验证凭证解析逻辑，不是通过云函数，也没有写入任何数据），
 * 分别用"完全不传凭证""传空字符串 secretId/secretKey""传格式正确但无效的
 * secretId/secretKey"这三种情况触发请求，确认了服务端的真实响应：
 *
 * | 触发条件 | error.code | 对应官方文档描述 |
 * |---|---|---|
 * | 完全不传任何凭证、或传空字符串 | `MISSING_CREDENTIALS` | "调用 API 时，请求头中没有身份验证信息" |
 * | 凭证格式正确但值无效/过期 | `INVALID_CREDENTIALS` | "凭证无效" |
 *
 * 另外两个错误码没有用真实网络请求触发过（只是查到了官方文档的描述，
 * 没有在本项目的真实环境里复现），标注为"仅查文档，未实测"：
 *
 * | 错误码 | 官方文档描述 | 触发条件（按文档） |
 * |---|---|---|
 * | `DATABASE_PERMISSION_DENIED` | "当前用户没有权限执行此数据库操作" | 凭证本身有效，但没有权限访问目标集合/文档（HTTP 401） |
 * | `DATABASE_COLLECTION_NOT_EXIST` | "操作的集合不存在" | 集合名称写错，或集合还没创建 |
 * | `DATABASE_REQUEST_FAILED` | "数据库请求失败，这是数据库操作的通用错误" | 没有更具体错误码可归类时的兜底 |
 *
 * 这五个错误码分别代表完全不同的根因，必须严格按 `error.code` 字段区分，
 * 不能用字符串模糊匹配——`INVALID_CREDENTIALS` 和 `DATABASE_PERMISSION_
 * DENIED` 都可能在 message 里提到"权限"/"invalid"，但前者是"身份本身没验证
 * 通过"，后者是"身份验证通过了、但没有权限"，根因和修复方式完全不同：
 * 前者要查凭证来源，后者要查 ADMINONLY 集合是不是真的配置对了。
 */

export type DbDiagnosticClassification =
  | 'MISSING_CREDENTIALS'
  | 'INVALID_CREDENTIALS'
  | 'DATABASE_PERMISSION_DENIED'
  | 'DATABASE_COLLECTION_NOT_EXIST'
  | 'DATABASE_REQUEST_FAILED'
  | 'UNKNOWN'

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'MISSING_CREDENTIALS',
  'INVALID_CREDENTIALS',
  'DATABASE_PERMISSION_DENIED',
  'DATABASE_COLLECTION_NOT_EXIST',
  'DATABASE_REQUEST_FAILED',
])

/** 从异常对象上取出 `code` 字段（真实报错对象是 `{message, code, requestId}` 形状的 Error 实例） */
function extractErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function classify(error: unknown): DbDiagnosticClassification {
  const code = extractErrorCode(error)
  if (code && KNOWN_CODES.has(code)) {
    return code as DbDiagnosticClassification
  }
  return 'UNKNOWN'
}

/**
 * 截断 + 脱敏调用堆栈：只保留前几行（足够定位是哪个函数调用出的问题），
 * 不整条贴出来——虽然堆栈本身一般不含凭证，但按"脱敏"的要求做保守处理，
 * 同时这里的路径是容器内的绝对路径，没有信息价值,多贴没有好处。
 */
function sanitizeStack(stack: string | undefined, maxLines: number): string | undefined {
  if (!stack) return undefined
  return stack.split('\n').slice(0, maxLines).join('\n')
}

export interface DbDiagnosticLogEntry {
  operation: string
  errorName: string
  errorCode: string
  classification: DbDiagnosticClassification
  /** 已脱敏：不含凭证值，只是错误描述文本本身（这些描述来自 CloudBase 官方错误码文档，不含用户数据） */
  errorMessage: string
  stackPreview: string | undefined
}

/**
 * 记录一条结构化的、已脱敏的数据库诊断日志。
 *
 * 绝对不记录：凭证实际值、Token、Authorization 头、完整环境变量列表。
 * 只记录：操作名、错误名称/错误码/错误信息（这些是 CloudBase 官方错误码
 * 体系里的标准描述，不是用户数据或凭证）、截断后的调用堆栈前几行。
 */
export function logDbDiagnostic(operation: string, error: unknown): DbDiagnosticLogEntry {
  const errorName = error instanceof Error ? error.name : typeof error
  const errorCode = extractErrorCode(error) ?? 'UNKNOWN'
  const errorMessage = error instanceof Error ? error.message : String(error)
  const stackPreview = error instanceof Error ? sanitizeStack(error.stack, 5) : undefined
  const classification = classify(error)

  const entry: DbDiagnosticLogEntry = {
    operation,
    errorName,
    errorCode,
    classification,
    errorMessage,
    stackPreview,
  }

  console.error('[db-diagnostic]', JSON.stringify(entry))
  return entry
}
