/**
 * 乐观锁冲突重试的公共逻辑。所有 handler（rejoinRoom/joinRoom/leaveRoom/
 * setOnline/startGame）都是"读 -> 计算 -> 带 version 条件写入 -> 失败则重读重试"
 * 这个模式，抽出来避免 5 份几乎一样的 for 循环。
 *
 * 之所以单独放一个文件：这是纯逻辑（不依赖 CloudBase SDK），
 * 可以直接用假的 attempt 函数测试重试次数和耗尽后的报错行为，
 * 不需要 mock 数据库。
 */
import { RoomError } from '../../../../shared/errors'

/**
 * @param maxAttempts 最多尝试次数
 * @param attempt 单次尝试：返回 null 表示"版本冲突，需要重试"，返回其他值表示成功
 * @throws RoomError('CONFLICT') 当重试次数耗尽仍未成功
 */
export async function retryOnConflict<T>(
  maxAttempts: number,
  attempt: () => Promise<T | null>,
): Promise<T> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const result = await attempt()
    if (result !== null) {
      return result
    }
  }
  throw new RoomError('CONFLICT', '操作冲突，请重试')
}
