/**
 * 对云函数调用的统一封装。
 *
 * UI 组件不应该直接 import `./cloudbase` 去调用 `app.callFunction`——
 * 全部走这一层，方便以后统一加超时、重试、错误码映射。
 */
import { app, ensureAnonymousLogin } from './cloudbase'
import type { ApiError, ErrorCode } from '../../../shared/errors'
import type {
  CreateRoomRequest,
  DevDbHealthCheckRequest,
  DevDbHealthCheckResult,
  GetRoomStateRequest,
  GetRoomStateResult,
  JoinRoomRequest,
  LeaveRoomRequest,
  LeaveRoomResult,
  RejoinRoomRequest,
  RoomActionResult,
  RoomRequest,
  SetOnlineRequest,
  StartGameRequest,
} from '../../../shared/api'

/** callFunction 失败、函数未部署等"调用没有成功执行"的情况，和业务错误码区分开 */
export class CallFunctionFailure extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'CallFunctionFailure'
    this.cause = cause
  }
}

/** 云函数返回了业务错误（`{ error: {...} }`） */
export class ApiBusinessError extends Error {
  code: ErrorCode

  constructor(apiError: ApiError) {
    super(apiError.message)
    this.name = 'ApiBusinessError'
    this.code = apiError.code
  }
}

interface RoomFunctionResponse<T> {
  ok: boolean
  data?: T
  error?: ApiError
}

/**
 * 调用 `room` 云函数。
 *
 * 当前 M1 阶段这个函数还没有被部署到远端，调用会失败——
 * 这是预期状态，调用方需要用 CallFunctionFailure 分支正确处理，
 * 而不是假装调用成功。
 */
async function callRoomFunction<T>(request: RoomRequest): Promise<T> {
  await ensureAnonymousLogin()

  let res
  try {
    res = await app.callFunction({ name: 'room', data: request })
  } catch (err) {
    throw new CallFunctionFailure('调用 room 云函数失败（网络或 SDK 异常）', err)
  }

  // CloudBase 的 callFunction 在"函数不存在/未部署"等情况下通常不会 reject，
  // 而是在返回值里带 code（如 FUNCTIONS_NOT_FOUND），所以这里要显式检查。
  if (res.code) {
    throw new CallFunctionFailure(
      `room 云函数调用未成功（code: ${res.code}）：${res.message ?? '函数可能尚未部署'}`,
    )
  }

  const result = res.result as RoomFunctionResponse<T> | undefined
  if (!result) {
    throw new CallFunctionFailure('room 云函数返回了空结果')
  }
  if (!result.ok || !result.data) {
    throw new ApiBusinessError(
      result.error ?? { code: 'INTERNAL_ERROR', message: '未知错误' },
    )
  }
  return result.data
}

export function createRoom(nickname: string): Promise<RoomActionResult> {
  const request: CreateRoomRequest = { action: 'createRoom', nickname }
  return callRoomFunction<RoomActionResult>(request)
}

export function joinRoom(roomCode: string, nickname: string): Promise<RoomActionResult> {
  const request: JoinRoomRequest = { action: 'joinRoom', roomCode, nickname }
  return callRoomFunction<RoomActionResult>(request)
}

export function rejoinRoom(roomCode: string): Promise<RoomActionResult> {
  const request: RejoinRoomRequest = { action: 'rejoinRoom', roomCode }
  return callRoomFunction<RoomActionResult>(request)
}

export function leaveRoom(roomId: string): Promise<LeaveRoomResult> {
  const request: LeaveRoomRequest = { action: 'leaveRoom', roomId }
  return callRoomFunction<LeaveRoomResult>(request)
}

export function setOnline(roomId: string, online: boolean): Promise<LeaveRoomResult> {
  const request: SetOnlineRequest = { action: 'setOnline', roomId, online }
  return callRoomFunction<LeaveRoomResult>(request)
}

export function startGame(roomId: string): Promise<RoomActionResult> {
  const request: StartGameRequest = { action: 'startGame', roomId }
  return callRoomFunction<RoomActionResult>(request)
}

/**
 * 获取房间公共状态快照。`rooms`/`players` 都是 ADMINONLY，前端不能直接
 * watch/get 数据库，等待大厅的状态同步都走这个 action（见
 * frontend/src/lib/roomPolling.ts 的低频轮询封装）。
 */
export function getRoomState(roomId: string): Promise<GetRoomStateResult> {
  const request: GetRoomStateRequest = { action: 'getRoomState', roomId }
  return callRoomFunction<GetRoomStateResult>(request)
}

/**
 * 仅供开发诊断使用：确认 room 云函数能否用当前凭证正常访问数据库。
 * 只读、不创建真实房间、不返回任何私人数据或密钥，成功时只返回
 * `{ dbConnected: boolean }`。
 */
export function devDbHealthCheck(): Promise<DevDbHealthCheckResult> {
  const request: DevDbHealthCheckRequest = { action: 'devDbHealthCheck' }
  return callRoomFunction<DevDbHealthCheckResult>(request)
}

/**
 * hello 云函数的返回形状，仅用于 Phase A 的连通性测试页。
 *
 * 不再有单独的 `isAnonymous: boolean` 当作唯一的"已认证"判断——
 * `authenticated` 固定为 `true`（函数能返回就说明身份解析通过了，
 * 解析失败会直接报错，不会返回这个结构），`isAnonymous` 只在服务端
 * 能明确确认是匿名登录时才是 `true`，`serverLoginType` 是原始调试信息，
 * 不代表任何安全判断（详见 functions/common/identity.ts 的注释）。
 */
export interface HelloResult {
  message: string
  uid: string
  authenticated: true
  isAnonymous: boolean
  serverLoginType: string | undefined
  requestTime: number
}

export async function callHello(): Promise<HelloResult> {
  await ensureAnonymousLogin()

  let res
  try {
    res = await app.callFunction({ name: 'hello' })
  } catch (err) {
    throw new CallFunctionFailure('调用 hello 云函数失败（网络或 SDK 异常）', err)
  }

  if (res.code) {
    throw new CallFunctionFailure(
      `hello 云函数调用未成功（code: ${res.code}）：${res.message ?? '函数可能尚未部署'}`,
    )
  }
  if (!res.result) {
    throw new CallFunctionFailure('hello 云函数返回了空结果')
  }
  return res.result as HelloResult
}
