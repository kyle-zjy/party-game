import { useState } from 'react'
import { ensureAnonymousLogin, getIdentityState } from '../lib/cloudbase'
import {
  createTestDoc,
  deleteTestDoc,
  getTestDoc,
  listMyTestDocs,
  updateTestDoc,
  type DbTestDoc,
} from '../lib/dbTest'

type StepStatus = 'idle' | 'running' | 'success' | 'error'

interface StepState {
  status: StepStatus
  error?: string
}

/**
 * 阶段 A 的开发用测试页：验证浏览器能否用 Web SDK 直接读写 CloudBase
 * 文档数据库（不经过 room 云函数）。不修改任何已有游戏代码，是单独新增的页面。
 *
 * 需要你先在 CloudBase 控制台创建 `dbtest` 集合，并配置成"已登录用户可读写"
 * （不是 ADMINONLY），否则这里的每一步都会显示真实的权限错误。
 * （集合名不能以下划线开头，CloudBase 控制台不允许，所以是 `dbtest`
 * 不是 `_dbtest`。）
 *
 * 失败时直接显示 SDK 返回的真实错误信息，不做任何掩盖或重新包装——
 * 这个页面本身就是用来快速看到"到底能不能读写、卡在哪一步"的，不是正式
 * 游戏页面，不需要像 room 云函数那样把错误消毒成通用提示。
 */
export function DbTestPage() {
  const [uid, setUid] = useState<string | null>(null)
  const [loginStep, setLoginStep] = useState<StepState>({ status: 'idle' })

  const [createStep, setCreateStep] = useState<StepState>({ status: 'idle' })
  const [docId, setDocId] = useState<string | null>(null)

  const [readStep, setReadStep] = useState<StepState>({ status: 'idle' })
  const [readDoc, setReadDoc] = useState<DbTestDoc | null>(null)

  const [listStep, setListStep] = useState<StepState>({ status: 'idle' })
  const [listDocs, setListDocs] = useState<DbTestDoc[]>([])

  const [updateStep, setUpdateStep] = useState<StepState>({ status: 'idle' })
  const [deleteStep, setDeleteStep] = useState<StepState>({ status: 'idle' })

  async function handleLogin() {
    setLoginStep({ status: 'running' })
    try {
      const currentUid = await ensureAnonymousLogin()
      const identity = await getIdentityState()
      if (!identity.hasSession) {
        throw new Error('登录后仍然没有真实 Session')
      }
      setUid(currentUid)
      setLoginStep({ status: 'success' })
    } catch (err) {
      setLoginStep({ status: 'error', error: describeError(err) })
    }
  }

  async function handleCreate() {
    if (!uid) return
    setCreateStep({ status: 'running' })
    setDocId(null)
    try {
      const id = await createTestDoc(`测试文档 @ ${new Date().toLocaleTimeString()}`, uid)
      setDocId(id)
      setCreateStep({ status: 'success' })
    } catch (err) {
      setCreateStep({ status: 'error', error: describeError(err) })
    }
  }

  async function handleRead() {
    if (!docId) return
    setReadStep({ status: 'running' })
    try {
      const doc = await getTestDoc(docId)
      setReadDoc(doc)
      setReadStep({ status: 'success' })
    } catch (err) {
      setReadStep({ status: 'error', error: describeError(err) })
    }
  }

  async function handleList() {
    if (!uid) return
    setListStep({ status: 'running' })
    try {
      const docs = await listMyTestDocs(uid)
      setListDocs(docs)
      setListStep({ status: 'success' })
    } catch (err) {
      setListStep({ status: 'error', error: describeError(err) })
    }
  }

  async function handleUpdate() {
    if (!docId) return
    setUpdateStep({ status: 'running' })
    try {
      await updateTestDoc(docId, `已更新 @ ${new Date().toLocaleTimeString()}`)
      setUpdateStep({ status: 'success' })
      await handleRead()
    } catch (err) {
      setUpdateStep({ status: 'error', error: describeError(err) })
    }
  }

  async function handleDelete() {
    if (!docId) return
    setDeleteStep({ status: 'running' })
    try {
      await deleteTestDoc(docId)
      setDeleteStep({ status: 'success' })
      setReadDoc(null)
      setDocId(null)
    } catch (err) {
      setDeleteStep({ status: 'error', error: describeError(err) })
    }
  }

  return (
    <section style={{ padding: 16, maxWidth: 430, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20 }}>数据库直连测试（阶段 A，开发用）</h1>
      <p className="text-muted" style={{ fontSize: 13 }}>
        测试浏览器直接读写 `dbtest` 集合。需要先在控制台把这个集合配置成
        "已登录用户可读写"，不是 ADMINONLY。
      </p>

      <div style={card}>
        <h2 style={cardTitle}>1. 匿名登录</h2>
        <p>状态：{stepLabel(loginStep.status)}</p>
        {uid && <p>uid：{uid}</p>}
        {loginStep.error && <p style={errorText}>{loginStep.error}</p>}
        <button style={button} onClick={handleLogin} disabled={loginStep.status === 'running'}>
          匿名登录
        </button>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>2. 新增（add）</h2>
        <p>状态：{stepLabel(createStep.status)}</p>
        {docId && <p>文档 ID：{docId}</p>}
        {createStep.error && <p style={errorText}>{createStep.error}</p>}
        <button style={button} onClick={handleCreate} disabled={!uid || createStep.status === 'running'}>
          新增测试文档
        </button>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>3. 查询单条（doc().get()）</h2>
        <p>状态：{stepLabel(readStep.status)}</p>
        {readDoc && <pre style={pre}>{JSON.stringify(readDoc, null, 2)}</pre>}
        {readStep.error && <p style={errorText}>{readStep.error}</p>}
        <button style={button} onClick={handleRead} disabled={!docId || readStep.status === 'running'}>
          查询这条文档
        </button>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>4. 查询列表（where().get()）</h2>
        <p>状态：{stepLabel(listStep.status)}</p>
        <p className="text-muted" style={{ fontSize: 12 }}>
          共 {listDocs.length} 条（当前用户创建的）
        </p>
        {listStep.error && <p style={errorText}>{listStep.error}</p>}
        <button style={button} onClick={handleList} disabled={!uid || listStep.status === 'running'}>
          查询我创建的全部文档
        </button>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>5. 更新（doc().update()）</h2>
        <p>状态：{stepLabel(updateStep.status)}</p>
        {updateStep.error && <p style={errorText}>{updateStep.error}</p>}
        <button style={button} onClick={handleUpdate} disabled={!docId || updateStep.status === 'running'}>
          更新这条文档
        </button>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>6. 删除（doc().remove()）</h2>
        <p>状态：{stepLabel(deleteStep.status)}</p>
        {deleteStep.error && <p style={errorText}>{deleteStep.error}</p>}
        <button style={button} onClick={handleDelete} disabled={!docId || deleteStep.status === 'running'}>
          删除这条文档
        </button>
      </div>
    </section>
  )
}

function stepLabel(status: StepStatus): string {
  switch (status) {
    case 'idle':
      return '尚未执行'
    case 'running':
      return '执行中…'
    case 'success':
      return '✅ 成功'
    case 'error':
      return '❌ 失败（见下方真实错误）'
  }
}

/** 不做任何掩盖，直接把 SDK/网络层面的真实错误信息显示出来 */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const card: React.CSSProperties = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
}

const cardTitle: React.CSSProperties = { fontSize: 16, margin: '0 0 8px' }

const button: React.CSSProperties = {
  width: '100%',
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
