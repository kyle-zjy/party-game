import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { ApiBusinessError, CallFunctionFailure } from '../lib/api'
import { saveNickname, loadNickname } from '../lib/session'
import { ERROR_MESSAGES_ZH } from '../../../shared/errors'
import { ROOM_CODE_LENGTH } from '../../../shared/constants'

export function HomePage() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(loadNickname())
  const [roomCode, setRoomCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function describeError(err: unknown): string {
    if (err instanceof ApiBusinessError) {
      return ERROR_MESSAGES_ZH[err.code] ?? err.message
    }
    if (err instanceof CallFunctionFailure) {
      return `暂时无法连接服务器（房间功能尚未部署或网络异常）：${err.message}`
    }
    return err instanceof Error ? err.message : String(err)
  }

  async function handleCreate() {
    setError(null)
    setBusy('create')
    try {
      saveNickname(nickname)
      const result = await api.createRoom(nickname)
      navigate(`/room/${result.room.roomCode}`)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleJoin() {
    setError(null)
    setBusy('join')
    try {
      saveNickname(nickname)
      const result = await api.joinRoom(roomCode, nickname)
      navigate(`/room/${result.room.roomCode}`)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
    }
  }

  const nicknameValid = nickname.trim().length > 0 && nickname.trim().length <= 12
  const roomCodeValid = /^\d{6}$/.test(roomCode)

  return (
    <div className="stack">
      <div>
        <h1>今夜别想下桌</h1>
        <h2>手机多人派对桌游</h2>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="nickname">你的昵称</label>
          <input
            id="nickname"
            className="input"
            maxLength={12}
            placeholder="输入昵称（1-12 个字符）"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <button
          className="btn btn-primary"
          disabled={!nicknameValid || busy !== null}
          onClick={handleCreate}
        >
          {busy === 'create' ? '创建中…' : '创建房间'}
        </button>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="roomCode">房间码</label>
          <input
            id="roomCode"
            className="input"
            inputMode="numeric"
            pattern="\d*"
            maxLength={ROOM_CODE_LENGTH}
            placeholder="输入 6 位房间码"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <button
          className="btn btn-secondary"
          disabled={!nicknameValid || !roomCodeValid || busy !== null}
          onClick={handleJoin}
        >
          {busy === 'join' ? '加入中…' : '加入房间'}
        </button>
      </div>

      {error && <p className="text-error">{error}</p>}
    </div>
  )
}
