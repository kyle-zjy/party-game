/**
 * 阶段 A：最小数据库连通测试——验证浏览器能否用 Web SDK 直接读写
 * CloudBase 文档数据库（不经过 room 云函数）。
 *
 * 用到的都是 `@cloudbase/js-sdk@3.10.2` 已发布的公开类型声明里的方法
 * （`core.d.ts`，不是反编译结果），这次不再花时间反编译 SDK 构建产物——
 * 测试失败就直接把真实错误显示出来，不再深挖 SDK 内部实现。
 *
 * 操作的集合名是 `dbtest`，需要你在 CloudBase 控制台创建，并配置成
 * "已登录用户可读写"（比如安全规则 `{"read": "auth.uid != null", "write":
 * "auth.uid != null"}`，或者控制台里"仅创建者可读写"之类的预设选项都可以，
 * 只要不是 ADMINONLY 就行——测试的就是"前端能不能直接访问"这件事）。
 *
 * 注意：集合名不能以下划线开头（CloudBase 控制台不允许），所以是
 * `dbtest` 不是 `_dbtest`。
 */
import { app } from './cloudbase'

export const DB_TEST_COLLECTION = 'dbtest'

export interface DbTestDoc {
  _id?: string
  message: string
  createdByUid: string
  createdAt: number
  updatedAt?: number
}

function db() {
  return app.database()
}

/** 新增一条测试文档，返回文档 ID */
export async function createTestDoc(message: string, uid: string): Promise<string> {
  const res = await db()
    .collection(DB_TEST_COLLECTION)
    .add({ message, createdByUid: uid, createdAt: Date.now() })
  if (res.code) {
    throw new Error(`新增失败：${res.code} ${res.message ?? ''}`)
  }
  if (!res.id) {
    throw new Error('新增成功但没有返回文档 ID，响应形状不符合预期')
  }
  return res.id
}

/** 按 ID 查询一条测试文档 */
export async function getTestDoc(id: string): Promise<DbTestDoc | null> {
  const res = await db().collection(DB_TEST_COLLECTION).doc(id).get()
  if (res.code) {
    throw new Error(`查询失败：${res.code} ${res.message ?? ''}`)
  }
  return (res.data[0] as DbTestDoc | undefined) ?? null
}

/** 查询当前用户创建的全部测试文档（验证 where 查询） */
export async function listMyTestDocs(uid: string): Promise<DbTestDoc[]> {
  const res = await db().collection(DB_TEST_COLLECTION).where({ createdByUid: uid }).get()
  if (res.code) {
    throw new Error(`列表查询失败：${res.code} ${res.message ?? ''}`)
  }
  return res.data as DbTestDoc[]
}

/** 更新一条测试文档 */
export async function updateTestDoc(id: string, message: string): Promise<void> {
  const res = await db()
    .collection(DB_TEST_COLLECTION)
    .doc(id)
    .update({ message, updatedAt: Date.now() })
  if (res.code) {
    throw new Error(`更新失败：${res.code} ${res.message ?? ''}`)
  }
}

/** 删除一条测试文档 */
export async function deleteTestDoc(id: string): Promise<void> {
  const res = await db().collection(DB_TEST_COLLECTION).doc(id).remove()
  if (res.code) {
    throw new Error(`删除失败：${res.code} ${res.message ?? ''}`)
  }
}
