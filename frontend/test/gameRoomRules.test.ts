import { describe, expect, it } from 'vitest'
import { MAX_PLAYERS, MIN_PLAYERS } from '../../shared/constants'
import type { GameRoom, GameRoomPlayer } from '../../shared/gameRoomTypes'
import {
  allocateSeat,
  assertCanStartGame,
  assertJoinable,
  generateRoomCode,
  isNicknameTaken,
  isRoomStale,
  pickNextHost,
  validateNickname,
  validateRoomCode,
} from '../../shared/gameRoomRules'

function makePlayer(overrides: Partial<GameRoomPlayer> = {}): GameRoomPlayer {
  return {
    uid: 'uid-1',
    nickname: 'Alice',
    seat: 0,
    isHost: false,
    joinedAt: Date.now(),
    ...overrides,
  }
}

function makeRoom(overrides: Partial<GameRoom> = {}): GameRoom {
  const now = Date.now()
  return {
    _id: 'room1',
    roomCode: '123456',
    status: 'WAITING',
    players: [makePlayer({ isHost: true })],
    playerCount: 1,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('validateNickname', () => {
  it('trims whitespace', () => {
    expect(validateNickname('  Bob  ')).toBe('Bob')
  })

  it('rejects empty nickname', () => {
    expect(() => validateNickname('   ')).toThrow()
  })

  it('rejects nickname over 12 characters', () => {
    expect(() => validateNickname('a'.repeat(13))).toThrow()
  })

  it('accepts exactly 12 characters', () => {
    expect(validateNickname('a'.repeat(12))).toBe('a'.repeat(12))
  })
})

describe('validateRoomCode', () => {
  it('accepts 6-digit code', () => {
    expect(() => validateRoomCode('000123')).not.toThrow()
  })

  it('rejects non-digit code', () => {
    expect(() => validateRoomCode('12a456')).toThrow()
  })

  it('rejects wrong length', () => {
    expect(() => validateRoomCode('12345')).toThrow()
    expect(() => validateRoomCode('1234567')).toThrow()
  })
})

describe('generateRoomCode', () => {
  it('always produces a 6-digit numeric string', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateRoomCode()).toMatch(/^\d{6}$/)
    }
  })
})

describe('isNicknameTaken', () => {
  it('is case-insensitive for ascii letters', () => {
    const players = [makePlayer({ nickname: 'Alice' })]
    expect(isNicknameTaken(players, 'alice')).toBe(true)
    expect(isNicknameTaken(players, 'ALICE')).toBe(true)
    expect(isNicknameTaken(players, 'Bob')).toBe(false)
  })

  it('compares non-ascii characters as-is', () => {
    const players = [makePlayer({ nickname: '小明' })]
    expect(isNicknameTaken(players, '小明')).toBe(true)
    expect(isNicknameTaken(players, '小红')).toBe(false)
  })
})

describe('allocateSeat', () => {
  it('allocates seat 0 for an empty room', () => {
    expect(allocateSeat([])).toBe(0)
  })

  it('allocates the smallest available seat', () => {
    const players = [makePlayer({ seat: 0 }), makePlayer({ seat: 2 })]
    expect(allocateSeat(players)).toBe(1)
  })

  it('allocates next seat when seats are contiguous', () => {
    const players = [makePlayer({ seat: 0 }), makePlayer({ seat: 1 })]
    expect(allocateSeat(players)).toBe(2)
  })
})

describe('pickNextHost', () => {
  it('returns null when no players remain', () => {
    expect(pickNextHost([])).toBeNull()
  })

  it('picks the player with the smallest seat', () => {
    const players = [makePlayer({ uid: 'a', seat: 3 }), makePlayer({ uid: 'b', seat: 1 })]
    expect(pickNextHost(players)?.uid).toBe('b')
  })
})

describe('isRoomStale', () => {
  const now = Date.now()

  it('is never stale while PLAYING, regardless of age', () => {
    expect(isRoomStale({ status: 'PLAYING', updatedAt: now - 1000 * 60 * 60 * 48 }, now)).toBe(
      false,
    )
  })

  it('is stale when WAITING and older than 24h', () => {
    expect(isRoomStale({ status: 'WAITING', updatedAt: now - 1000 * 60 * 60 * 25 }, now)).toBe(
      true,
    )
  })

  it('is not stale when WAITING and within 24h', () => {
    expect(isRoomStale({ status: 'WAITING', updatedAt: now - 1000 * 60 * 60 * 23 }, now)).toBe(
      false,
    )
  })
})

describe('assertJoinable', () => {
  it('throws ROOM_NOT_WAITING when room already started', () => {
    const room = makeRoom({ status: 'PLAYING' })
    expect(() => assertJoinable(room, 'new-uid', Date.now())).toThrow(
      expect.objectContaining({ code: 'ROOM_NOT_WAITING' }),
    )
  })

  it('throws ROOM_STALE for an expired WAITING room', () => {
    const room = makeRoom({ updatedAt: Date.now() - 1000 * 60 * 60 * 25 })
    expect(() => assertJoinable(room, 'new-uid', Date.now())).toThrow(
      expect.objectContaining({ code: 'ROOM_STALE' }),
    )
  })

  it('throws ROOM_FULL when at max players', () => {
    const players = Array.from({ length: MAX_PLAYERS }, (_, i) =>
      makePlayer({ uid: `u${i}`, seat: i }),
    )
    const room = makeRoom({ players })
    expect(() => assertJoinable(room, 'new-uid', Date.now())).toThrow(
      expect.objectContaining({ code: 'ROOM_FULL' }),
    )
  })

  it('throws CONFLICT when uid is already a member', () => {
    const room = makeRoom({ players: [makePlayer({ uid: 'existing-uid' })] })
    expect(() => assertJoinable(room, 'existing-uid', Date.now())).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    )
  })

  it('does not throw for a healthy WAITING room with space and a new uid', () => {
    const room = makeRoom()
    expect(() => assertJoinable(room, 'new-uid', Date.now())).not.toThrow()
  })
})

describe('assertCanStartGame', () => {
  it('throws NOT_HOST when caller is not host', () => {
    const players = [makePlayer({ uid: 'host', isHost: true }), makePlayer({ uid: 'guest', seat: 1 })]
    const room = makeRoom({ players })
    expect(() => assertCanStartGame(room, 'guest')).toThrow(
      expect.objectContaining({ code: 'NOT_HOST' }),
    )
  })

  it('throws ROOM_NOT_WAITING when already playing', () => {
    const room = makeRoom({ status: 'PLAYING' })
    expect(() => assertCanStartGame(room, room.players[0]!.uid)).toThrow(
      expect.objectContaining({ code: 'ROOM_NOT_WAITING' }),
    )
  })

  it('throws NOT_ENOUGH_PLAYERS when below minimum', () => {
    const room = makeRoom({ players: [makePlayer({ isHost: true })] })
    expect(() => assertCanStartGame(room, room.players[0]!.uid)).toThrow(
      expect.objectContaining({ code: 'NOT_ENOUGH_PLAYERS' }),
    )
  })

  it('does not throw when host and enough players', () => {
    const players = Array.from({ length: MIN_PLAYERS }, (_, i) =>
      makePlayer({ uid: `p${i}`, seat: i, isHost: i === 0 }),
    )
    const room = makeRoom({ players })
    expect(() => assertCanStartGame(room, 'p0')).not.toThrow()
  })
})
