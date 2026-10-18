/**
 * 对 `@cloudbase/js-sdk@3.10.2` 类型声明缺口的本地补丁。
 *
 * 背景（详见 docs/next-remote-steps.md 的记录）：
 * `cloudbase.database.App`（`app.database()` 的返回类型）在这个版本的
 * `core.d.ts` 里没有声明 `runTransaction` / `startTransaction`，
 * 但运行时对象上实际存在这两个方法（反编译确认签名和 node-sdk 文档一致）。
 *
 * 这里不用 `any` 绕过，而是显式声明出我们实际会用到的最小接口，
 * 等官方修复类型声明后可以整体删除这个文件。
 */

export interface TransactionDocument {
  get(): Promise<{ data: unknown[] }>
  // 和真实 SDK 签名（`set(data: Object)`）保持一致，用 object 而不是
  // Record<string, unknown>，这样带具体字段的 interface（如 RoomDoc）可以直接传入。
  set(data: object): Promise<unknown>
  update(data: object): Promise<unknown>
  remove(): Promise<unknown>
}

export interface TransactionCollection {
  doc(id: string): TransactionDocument
}

export interface Transaction {
  collection(name: string): TransactionCollection
  commit(): Promise<void>
  rollback(reason?: unknown): Promise<void>
}

export interface DbWithTransaction {
  runTransaction<T>(callback: (transaction: Transaction) => Promise<T>, times?: number): Promise<T>
}
