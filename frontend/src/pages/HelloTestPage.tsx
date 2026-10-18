import { useState } from 'react'
import { ensureAnonymousLogin, getIdentityState, type IdentityState } from '../lib/cloudbase'
import { ApiBusinessError, callHello, CallFunctionFailure, devDbHealthCheck, type HelloResult } from '../lib/api'

type LoginStatus = 'idle' | 'loading' | 'ready' | 'error'
type CallStatus = 'idle' | 'loading' | 'success' | 'not-deployed' | 'error'
type DbCheckStatus = 'idle' | 'loading' | 'connected' | 'disconnected' | 'error'

/**
 * Phase A 的开发用联通性测试页。
 *
 * 这不是 Milestone 1 的正式页面，只是用来在真正做房间系统之前，
 * 验证"前端 SDK 初始化 + 匿名登录 + 调用云函数"这条链路是否打通，
 * 并且验证前端拿到的身份和服务端解析出的身份是同一个人。
 *
 * 只展示：是否有真实 session、当前 uid、是否匿名登录、服务端返回的 uid、
 * 两者是否一致。绝不展示 access token / refresh token / Authorization /
 * accessKey 完整值 / 任何 Secret。
 */
export function HelloTestPage() {
  const [loginStatus, setLoginStatus] = useState<LoginStatus>('idle')
  const [identity, setIdentity] = useState<IdentityState | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)

  const [callStatus, setCallStatus] = useState<CallStatus>('idle')
  const [helloResult, setHelloResult] = useState<HelloResult | null>(null)
  const [callError, setCallError] = useState<string | null>(null)

  const [dbCheckStatus, setDbCheckStatus] = useState<DbCheckStatus>('idle')
  const [dbCheckError, setDbCheckError] = useState<string | null>(null)

  async function handleCheckSession() {
    setLoginStatus('loading')
    setLoginError(null)
    try {
      const state = await getIdentityState()
      setIdentity(state)
      setLoginStatus('ready')
    } catch (err) {
      setLoginStatus('error')
      setLoginError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleLogin() {
    setLoginStatus('loading')
    setLoginError(null)
    try {
      await ensureAnonymousLogin()
      const state = await getIdentityState()
      setIdentity(state)
      setLoginStatus('ready')
    } catch (err) {
      setLoginStatus('error')
      setLoginError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCallHello() {
    setCallStatus('loading')
    setCallError(null)
    setHelloResult(null)
    try {
      const result = await callHello()
      setHelloResult(result)
      setCallStatus('success')
    } catch (err) {
      if (err instanceof CallFunctionFailure) {
        // 这是预期状态：hello 云函数在 M1 这个阶段可能还没有被部署到远端。
        setCallStatus('not-deployed')
        setCallError(err.message)
      } else {
        setCallStatus('error')
        setCallError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  async function handleDbHealthCheck() {
    setDbCheckStatus('loading')
    setDbCheckError(null)
    try {
      const result = await devDbHealthCheck()
      setDbCheckStatus(result.dbConnected ? 'connected' : 'disconnected')
    } catch (err) {
      setDbCheckStatus('error')
      if (err instanceof ApiBusinessError || err instanceof CallFunctionFailure) {
        setDbCheckError(err.message)
      } else {
        setDbCheckError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const uidMatch =
    identity?.hasSession && helloResult
      ? identity.uid === helloResult.uid
        ? 'match'
        : 'mismatch'
      : null

  return (
    <section style={{ padding: 16, maxWidth: 430, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20 }}>CloudBase 连接测试（开发用）</h1>

      <div style={card}>
        <h2 style={cardTitle}>1. SDK 初始化</h2>
        <p>Env ID: {import.meta.env.VITE_CLOUDBASE_ENV_ID}</p>
        <p>状态：SDK 已加载（app/auth 实例创建成功，否则本页面本身会白屏）</p>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>2. 真实 Session / 身份状态</h2>
        <p>状态：{loginStatusLabel(loginStatus)}</p>
        {identity && (
          <>
            <p>2. 是否存在真实 Session：{identity.hasSession ? '是' : '否'}</p>
            <p>3. 当前用户 uid：{identity.uid ?? '（无）'}</p>
            <p>4. 是否为真正的匿名登录用户：{identity.isAnonymous ? '是' : '否'}</p>
          </>
        )}
        {loginError && <p style={errorText}>{loginError}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={button} onClick={handleCheckSession} disabled={loginStatus === 'loading'}>
            检查当前 Session
          </button>
          <button style={button} onClick={handleLogin} disabled={loginStatus === 'loading'}>
            {loginStatus === 'loading' ? '登录中…' : '匿名登录'}
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          "检查当前 Session" 只读取本地状态，不会发起登录；"匿名登录" 会在
          没有真实 session 时调用 signInAnonymously()。刷新页面后点
          "检查当前 Session"，应该能看到同一个 uid（见验证项 D）。
        </p>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>3. 调用 hello 云函数</h2>
        <p>状态：{callStatusLabel(callStatus)}</p>
        {helloResult && (
          <>
            <p>5. 服务端返回的 uid：{helloResult.uid}</p>
            <p>6. 前后端 uid 是否一致：{uidMatchLabel(uidMatch)}</p>
            <p>
              服务端是否确认为匿名登录：{helloResult.isAnonymous ? '是' : '不能确认（可能是实名，也可能字段缺失）'}
            </p>
            <p className="text-muted" style={{ fontSize: 12 }}>
              服务端原始 loginType（仅调试展示，不代表安全判断）：
              {helloResult.serverLoginType ?? '（无）'}
            </p>
            <pre style={pre}>{JSON.stringify(helloResult, null, 2)}</pre>
          </>
        )}
        {callStatus === 'not-deployed' && (
          <p style={warnText}>
            提示：hello 云函数尚未部署到远端 CloudBase 环境，这是开发阶段的预期状态。
            <br />
            详情：{callError}
          </p>
        )}
        {callStatus === 'error' && callError && <p style={errorText}>{callError}</p>}
        <button style={button} onClick={handleCallHello} disabled={callStatus === 'loading'}>
          {callStatus === 'loading' ? '调用中…' : '调用 hello'}
        </button>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>4. 数据库连通性检查（开发用）</h2>
        <p className="text-muted" style={{ fontSize: 12 }}>
          只读、不创建真实房间、不返回任何房间数据——成功时只返回连通状态，
          用来快速确认 room 云函数能否用当前凭证访问数据库。
        </p>
        <p>状态：{dbCheckStatusLabel(dbCheckStatus)}</p>
        {dbCheckStatus === 'error' && dbCheckError && <p style={errorText}>{dbCheckError}</p>}
        <button style={button} onClick={handleDbHealthCheck} disabled={dbCheckStatus === 'loading'}>
          {dbCheckStatus === 'loading' ? '检查中…' : '检查数据库连通性'}
        </button>
      </div>
    </section>
  )
}

function loginStatusLabel(status: LoginStatus): string {
  switch (status) {
    case 'idle':
      return '尚未检查'
    case 'loading':
      return '处理中…'
    case 'ready':
      return '已检查'
    case 'error':
      return '出错'
  }
}

function callStatusLabel(status: CallStatus): string {
  switch (status) {
    case 'idle':
      return '尚未调用'
    case 'loading':
      return '调用中…'
    case 'success':
      return '调用成功'
    case 'not-deployed':
      return '函数尚未部署 / 调用失败'
    case 'error':
      return '调用出错'
  }
}

function uidMatchLabel(match: 'match' | 'mismatch' | null): string {
  if (match === 'match') return '✅ 一致'
  if (match === 'mismatch') return '❌ 不一致（有问题）'
  return '（尚未同时拿到前后端 uid）'
}

function dbCheckStatusLabel(status: DbCheckStatus): string {
  switch (status) {
    case 'idle':
      return '尚未检查'
    case 'loading':
      return '检查中…'
    case 'connected':
      return '✅ 数据库连通正常'
    case 'disconnected':
      return '❌ 数据库连接失败（具体原因已记录在服务端日志，不会显示在这里）'
    case 'error':
      return '调用出错'
  }
}

const card: React.CSSProperties = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
}

const cardTitle: React.CSSProperties = { fontSize: 16, margin: '0 0 8px' }

const button: React.CSSProperties = {
  flex: 1,
  padding: '12px 0',
  fontSize: 15,
  borderRadius: 8,
  border: 'none',
  background: '#6b4fff',
  color: '#fff',
}

const pre: React.CSSProperties = {
  background: '#f4f3ec',
  padding: 8,
  borderRadius: 4,
  fontSize: 12,
  overflowX: 'auto',
}

const errorText: React.CSSProperties = { color: '#c0392b', fontSize: 13 }
const warnText: React.CSSProperties = { color: '#b8860b', fontSize: 13 }
