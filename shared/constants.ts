/**
 * 房间规则相关的常量。
 *
 * 前端和云函数都会引用这些值，但只有云函数里的校验才是权威的——
 * 前端引用它们仅用于提前给出提示，不能替代服务端校验。
 */

/** 房间最少人数，开始游戏的硬性门槛 */
export const MIN_PLAYERS = 3

/** 房间最多人数 */
export const MAX_PLAYERS = 10

/** 昵称最大长度（按字符数，不是字节数） */
export const NICKNAME_MAX_LENGTH = 12

/** 房间码长度 */
export const ROOM_CODE_LENGTH = 6

/** 房间码只能是数字 */
export const ROOM_CODE_PATTERN = /^\d{6}$/

/**
 * 房间判定为"过期"的时间窗口（毫秒）。
 * updatedAt 超过这个时间的 WAITING/CLOSED 房间，joinRoom 时视为不可加入，
 * 生成房间码时也不把它算作活跃冲突。
 *
 * Milestone 1 只做"判定"，不做真正的清理/删除。
 */
export const ROOM_STALE_MS = 24 * 60 * 60 * 1000
