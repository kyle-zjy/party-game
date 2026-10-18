import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ensureAnonymousLogin } from '../lib/cloudbase'
import { createGameRoom, joinGameRoom } from '../lib/gameRoomDb'
import { loadNickname, saveNickname } from '../lib/session'
import { describeUnknownError } from '../../../shared/errors'
import { ROOM_CODE_LENGTH } from '../../../shared/constants'
import '../game/theme.css'
import './gameRoomHomePage.css'

/**
 * 正式玩家入口——`/` 默认重定向到这里（见 App.tsx），不再是旧模型的
 * `HomePage.tsx`（调用已下线的 `room` 云函数，会报"服务器内部错误"）。
 *
 * 视觉上改用"午夜奇幻酒馆"主题（`../game/theme.css`），和 Phase C.1 修复后
 * 的正式棋盘页保持统一风格，不再是阶段 A/B 遗留的素色卡片样式——
 * 这是用户在"统一首页和游戏内 UI 风格"需求里明确要求的部分。
 *
 * 数据层只调用 `gameRoomDb.ts`（`game_rooms` 前端直连数据库），不调用
 * `lib/api.ts`（旧版 `room` 云函数）——这正是本轮修复的 P0 问题本身。
 */
export function GameRoomHomePage() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(loadNickname())
  const [roomCode, setRoomCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setError(null)
    setBusy('create')
    try {
      saveNickname(nickname)
      const uid = await ensureAnonymousLogin()
      const result = await createGameRoom(nickname, uid)
      navigate(`/mp/${result.room.roomCode}`)
    } catch (err) {
      if (import.meta.env.DEV) console.error('[GameRoomHomePage] 创建房间失败，原始错误：', err)
      setError(describeUnknownError(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleJoin() {
    setError(null)
    setBusy('join')
    try {
      saveNickname(nickname)
      const uid = await ensureAnonymousLogin()
      const result = await joinGameRoom(roomCode, nickname, uid)
      navigate(`/mp/${result.room.roomCode}`)
    } catch (err) {
      if (import.meta.env.DEV) console.error('[GameRoomHomePage] 加入房间失败，原始错误：', err)
      setError(describeUnknownError(err))
    } finally {
      setBusy(null)
    }
  }

  const nicknameValid = nickname.trim().length > 0 && nickname.trim().length <= 12
  const roomCodeValid = /^\d{6}$/.test(roomCode)

  return (
    <div className="mg-root mg-home-page">
      <div className="mg-home-hero">
        <p className="mg-pill mg-glow-purple">午夜奇幻酒馆派对桌游</p>
        <h1 className="mg-display mg-home-title">今夜别想下桌</h1>
        <p className="mg-muted">3–10 人手机多人聚会桌游，掷骰、买地产、翻主牌、斗战术牌</p>
      </div>

      <div className="mg-card mg-home-card">
        <div className="mg-field">
          <label htmlFor="nickname" className="mg-field-label">
            你的昵称
          </label>
          <input
            id="nickname"
            className="mg-input"
            maxLength={12}
            placeholder="输入昵称（1-12 个字符）"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <button
          type="button"
          className="mg-btn mg-btn-gold"
          style={{ width: '100%' }}
          disabled={!nicknameValid || busy !== null}
          onClick={() => void handleCreate()}
        >
          {busy === 'create' ? '创建中…' : '创建房间'}
        </button>
      </div>

      <div className="mg-card mg-home-card">
        <div className="mg-field">
          <label htmlFor="roomCode" className="mg-field-label">
            房间码
          </label>
          <input
            id="roomCode"
            className="mg-input"
            inputMode="numeric"
            pattern="\d*"
            maxLength={ROOM_CODE_LENGTH}
            placeholder="输入 6 位房间码"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <button
          type="button"
          className="mg-btn mg-btn-primary"
          style={{ width: '100%' }}
          disabled={!nicknameValid || !roomCodeValid || busy !== null}
          onClick={() => void handleJoin()}
        >
          {busy === 'join' ? '加入中…' : '加入房间'}
        </button>
      </div>

      {error && (
        <div className="mg-error-toast" role="alert">
          <span>{error}</span>
          <button type="button" className="mg-btn-icon" onClick={() => setError(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
    </div>
  )
}
