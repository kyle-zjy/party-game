import { describe, expect, it } from 'vitest'
import { colorForSeat, initGameState, INITIAL_COINS } from '../../../shared/game/engine/initGame'
import { startCellIdForColor } from '../../../shared/game/engine/movement'
import type { GameRoomPlayer } from '../../../shared/gameRoomTypes'

function makeRoomPlayer(overrides: Partial<GameRoomPlayer> = {}): GameRoomPlayer {
  return {
    uid: 'uid-1',
    nickname: 'Alice',
    seat: 0,
    isHost: false,
    joinedAt: Date.now(),
    ...overrides,
  }
}

describe('initGameState', () => {
  it('initializes 3 players with correct starting resources (V1.5 rulebook section 1)', () => {
    const players = [
      makeRoomPlayer({ uid: 'u1', nickname: 'Alice', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', nickname: 'Bob', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', nickname: 'Carol', seat: 2 }),
    ]
    const state = initGameState(players, 1000)

    expect(state.turnOrder).toEqual(['u1', 'u2', 'u3'])
    expect(state.currentPlayerIndex).toBe(0)
    expect(state.turn.currentPlayerUid).toBe('u1')
    expect(state.turn.phase).toBe('ROLLING')
    expect(state.finished).toBe(false)

    for (const uid of ['u1', 'u2', 'u3']) {
      const p = state.players[uid]!
      expect(p.coins).toBe(INITIAL_COINS)
      expect(p.coins).toBe(5)
      expect(p.tacticHand).toHaveLength(1)
      expect(p.texasHoleCards).toHaveLength(2)
      expect(p.properties).toEqual([])
      expect(p.identityCardId).toBe('identity-guest')
      expect(p.position).toBe(startCellIdForColor(p.color))
    }
  })

  it('assigns distinct colors to each of the first 4 seats', () => {
    const colors = [0, 1, 2, 3].map(colorForSeat)
    expect(new Set(colors).size).toBe(4)
  })

  it('places each player on their own color start cell', () => {
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0 }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const state = initGameState(players, 1000)
    for (const uid of ['u1', 'u2', 'u3']) {
      const p = state.players[uid]!
      expect(p.position).toBe(startCellIdForColor(p.color))
    }
  })

  it('deals distinct hole cards across players (no duplicate cards)', () => {
    const players = Array.from({ length: 6 }, (_, i) => makeRoomPlayer({ uid: `u${i}`, seat: i }))
    const state = initGameState(players, 1000)
    const allCards = Object.values(state.players).flatMap((p) => p.texasHoleCards)
    expect(new Set(allCards).size).toBe(allCards.length)
  })

  it('throws when there are no players', () => {
    expect(() => initGameState([], 1000)).toThrow()
  })

  it('supports a full 10-player room', () => {
    const players = Array.from({ length: 10 }, (_, i) => makeRoomPlayer({ uid: `u${i}`, seat: i }))
    const state = initGameState(players, 1000)
    expect(state.turnOrder).toHaveLength(10)
    expect(Object.keys(state.players)).toHaveLength(10)
  })

  it('picks an initial world tarot', () => {
    const players = [makeRoomPlayer({ uid: 'u1', seat: 0 }), makeRoomPlayer({ uid: 'u2', seat: 1 }), makeRoomPlayer({ uid: 'u3', seat: 2 })]
    const state = initGameState(players, 1000)
    expect(state.currentTarotId).toMatch(/^tarot-/)
  })
})
