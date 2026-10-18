import { describe, expect, it } from 'vitest'
import { RoomError } from '../../../shared/errors'
import { retryOnConflict } from '../src/lib/retry'

describe('retryOnConflict', () => {
  it('returns the result on first success', async () => {
    const result = await retryOnConflict(3, async () => 'ok')
    expect(result).toBe('ok')
  })

  it('retries until a non-null result is returned', async () => {
    let calls = 0
    const result = await retryOnConflict(3, async () => {
      calls += 1
      return calls < 3 ? null : 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('throws RoomError CONFLICT after exhausting attempts', async () => {
    let calls = 0
    await expect(
      retryOnConflict(3, async () => {
        calls += 1
        return null
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(calls).toBe(3)
  })

  it('propagates errors thrown by attempt() without retrying', async () => {
    let calls = 0
    await expect(
      retryOnConflict(3, async () => {
        calls += 1
        throw new RoomError('NOT_HOST', 'nope')
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'NOT_HOST' }))
    expect(calls).toBe(1)
  })
})
