import { describe, expect, it } from 'vitest'
import { initGameState } from '../../../shared/game/engine/initGame'
import {
  applyAdvanceAfterLanding,
  applyBuyPropertyDecision,
  applyEndTurn,
  applyResolveLanding,
  applyRevealLadyCard,
  applyRollDice,
  applySkipTactic,
  GameActionError,
} from '../../../shared/game/engine/turnEngine'
import type { GameRoomPlayer } from '../../../shared/gameRoomTypes'
import type { GameState } from '../../../shared/game/types'
import { getCell, isPropertyCell } from '../../../shared/game/board'

function makeRoomPlayer(overrides: Partial<GameRoomPlayer> = {}): GameRoomPlayer {
  return { uid: 'uid-1', nickname: 'Alice', seat: 0, isHost: false, joinedAt: Date.now(), ...overrides }
}

function makeThreePlayerGame(): GameState {
  const players = [
    makeRoomPlayer({ uid: 'u1', nickname: 'Alice', seat: 0, isHost: true }),
    makeRoomPlayer({ uid: 'u2', nickname: 'Bob', seat: 1 }),
    makeRoomPlayer({ uid: 'u3', nickname: 'Carol', seat: 2 }),
  ]
  return initGameState(players, 1000)
}

describe('full turn loop: roll -> land -> lady card -> tactic -> end turn', () => {
  it('cycles through 3 players repeatedly (at least 2 full laps)', () => {
    let state = makeThreePlayerGame()
    const order = state.turnOrder
    for (let round = 0; round < 6; round += 1) {
      const expectedUid = order[round % 3]!
      expect(state.turn.currentPlayerUid).toBe(expectedUid)
      expect(state.turn.phase).toBe('ROLLING')
      // use a small natural roll that is very unlikely to land on an owned/occupied
      // interesting cell during this synthetic test; cell 1 near start is 'event changeTarot'
      // which triggers a pendingDecision (HOST_RULING) — pick roll=1 only for player at start cells.
      // To keep the helper simple and avoid every possible landing type, directly drive the phases here instead.
      state = applyRollDice(state, expectedUid, 2)
      const landing = applyResolveLanding(state, expectedUid, 2000)
      state = landing.state
      // Resolve any pending decision generically for this loop test (buy/skip, ack, ruling ack by host, etc.)
      state = resolvePendingDecisionIfAny(state, expectedUid, order[0]!)
      state = applyAdvanceAfterLanding(state, expectedUid, 2000)
      if (state.turn.phase === 'ROLLING') {
        // natural six chain — finish the extra roll with a non-six value
        state = applyRollDice(state, expectedUid, 1)
        const landing2 = applyResolveLanding(state, expectedUid, 2000)
        state = landing2.state
        state = resolvePendingDecisionIfAny(state, expectedUid, order[0]!)
        state = applyAdvanceAfterLanding(state, expectedUid, 2000)
      }
      expect(state.turn.phase).toBe('LADY_CARD')
      const reveal = applyRevealLadyCard(state, expectedUid, 'lady-3', 2000)
      state = reveal.state
      state = applySkipTactic(state, expectedUid, 2000)
      state = applyEndTurn(state, expectedUid, 2000)
    }
    // after 6 turns with 3 players, we should be back at player 0
    expect(state.turn.currentPlayerUid).toBe(order[0])
  })
})

function resolvePendingDecisionIfAny(state: GameState, currentUid: string, hostUid: string): GameState {
  const decision = state.turn.pendingDecision
  if (!decision) return state
  if (decision.kind === 'BUY_PROPERTY') {
    return applyBuyPropertyDecision(state, currentUid, false, 2000)
  }
  if (decision.kind === 'DRINK_ACK') {
    return { ...state, turn: { ...state.turn, pendingDecision: null } }
  }
  if (decision.kind === 'HOST_RULING') {
    return { ...state, turn: { ...state.turn, pendingDecision: null } }
  }
  if (decision.kind === 'CHOOSE_DRINK_TARGET' || decision.kind === 'TRUTH_OR_DARE' || decision.kind === 'NATURAL_SIX_CHAIN') {
    return { ...state, turn: { ...state.turn, pendingDecision: null } }
  }
  void hostUid
  return state
}

describe('rollDice', () => {
  it('rejects rolling when it is not the caller uid turn', () => {
    const state = makeThreePlayerGame()
    expect(() => applyRollDice(state, 'u2', 3)).toThrow(GameActionError)
    try {
      applyRollDice(state, 'u2', 3)
    } catch (e) {
      expect((e as GameActionError).code).toBe('NOT_YOUR_TURN')
    }
  })

  it('rejects rolling twice in a row without resolving landing first', () => {
    const state = makeThreePlayerGame()
    const afterRoll = applyRollDice(state, 'u1', 3)
    expect(() => applyRollDice(afterRoll, 'u1', 4)).toThrow(GameActionError)
  })

  it('records natural six correctly', () => {
    const state = makeThreePlayerGame()
    const afterRoll = applyRollDice(state, 'u1', 6)
    expect(afterRoll.turn.lastRoll?.isNaturalSix).toBe(true)
    expect(afterRoll.turn.phase).toBe('LANDING')
  })
})

describe('natural six extra roll', () => {
  it('grants an extra roll that only resolves landing, without an extra lady card reveal', () => {
    let state = makeThreePlayerGame()
    state = applyRollDice(state, 'u1', 6)
    const landing1 = applyResolveLanding(state, 'u1', 2000)
    state = landing1.state
    state = resolvePendingDecisionIfAny(state, 'u1', 'u1')
    state = applyAdvanceAfterLanding(state, 'u1', 2000)

    // should be back in ROLLING for the extra roll, not LADY_CARD
    expect(state.turn.phase).toBe('ROLLING')
    expect(state.turn.extraRollPending).toBe(true)
    expect(state.turn.extraRollUsed).toBe(false)

    state = applyRollDice(state, 'u1', 3)
    const landing2 = applyResolveLanding(state, 'u1', 2000)
    state = landing2.state
    state = resolvePendingDecisionIfAny(state, 'u1', 'u1')
    state = applyAdvanceAfterLanding(state, 'u1', 2000)

    // extra roll landing resolved -> now proceeds to LADY_CARD (only once, not twice)
    expect(state.turn.phase).toBe('LADY_CARD')
    expect(state.turn.extraRollUsed).toBe(true)

    const reveal = applyRevealLadyCard(state, 'u1', 'lady-4', 2000)
    state = reveal.state
    expect(state.turn.revealedLadyCardId).toBe('lady-4')

    // cannot reveal a second lady card in the same turn
    expect(() => applyRevealLadyCard(state, 'u1', 'lady-5', 2000)).toThrow(GameActionError)
  })
})

describe('other players cannot act on the current player turn via normal actions', () => {
  it('rejects a non-current player trying to resolve landing, reveal lady card, or end turn', () => {
    let state = makeThreePlayerGame()
    state = applyRollDice(state, 'u1', 3)
    expect(() => applyResolveLanding(state, 'u2', 2000)).toThrow(GameActionError)
    const landing = applyResolveLanding(state, 'u1', 2000)
    state = resolvePendingDecisionIfAny(landing.state, 'u1', 'u1')
    state = applyAdvanceAfterLanding(state, 'u1', 2000)
    if (state.turn.phase === 'ROLLING') {
      // consume extra roll deterministically for this test's purposes
      state = applyRollDice(state, 'u1', 2)
      const l2 = applyResolveLanding(state, 'u1', 2000)
      state = resolvePendingDecisionIfAny(l2.state, 'u1', 'u1')
      state = applyAdvanceAfterLanding(state, 'u1', 2000)
    }
    expect(() => applyRevealLadyCard(state, 'u3', 'lady-2', 2000)).toThrow(GameActionError)
    const reveal = applyRevealLadyCard(state, 'u1', 'lady-2', 2000)
    state = reveal.state
    expect(() => applyEndTurn(state, 'u2', 2000)).toThrow(GameActionError)
  })
})

describe('refresh / resume mid-phase', () => {
  it('phase and pendingDecision survive being serialized and restored like a page refresh would', () => {
    let state = makeThreePlayerGame()
    state = applyRollDice(state, 'u1', 3)
    const landing = applyResolveLanding(state, 'u1', 2000)
    state = landing.state

    // simulate refresh: serialize to JSON and back (CloudBase stores plain JSON documents)
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    expect(restored.turn.phase).toBe(state.turn.phase)
    expect(restored.turn.pendingDecision).toEqual(state.turn.pendingDecision)
    expect(restored.turn.currentPlayerUid).toBe('u1')

    // continuing from the restored state should work exactly as if nothing happened
    if (restored.turn.pendingDecision?.kind === 'BUY_PROPERTY') {
      const afterBuy = applyBuyPropertyDecision(restored, 'u1', false, 3000)
      expect(afterBuy.turn.pendingDecision).toBeNull()
    }
  })
})

describe('property purchase and rent', () => {
  it('lets the current player buy an unowned property they land on', () => {
    let state = makeThreePlayerGame()
    // find a property cell reachable from u1's start within a small number of steps
    const start = state.players['u1']!.position
    let steps = 1
    let targetCell = getCell((start + steps) % 74)
    while (!isPropertyCell(targetCell) && steps < 74) {
      steps += 1
      targetCell = getCell((start + steps) % 74)
    }
    expect(isPropertyCell(targetCell)).toBe(true)

    state = applyRollDice(state, 'u1', steps)
    const landing = applyResolveLanding(state, 'u1', 2000)
    state = landing.state
    expect(state.turn.pendingDecision?.kind).toBe('BUY_PROPERTY')

    const coinsBefore = state.players['u1']!.coins
    state = applyBuyPropertyDecision(state, 'u1', true, 2000)
    expect(state.players['u1']!.coins).toBe(coinsBefore - 3)
    if (isPropertyCell(targetCell)) {
      expect(state.players['u1']!.properties).toContain(targetCell.propertyName)
    }
    expect(state.turn.pendingDecision).toBeNull()
  })

  it('rejects buying when the player cannot afford it', () => {
    let state = makeThreePlayerGame()
    state = { ...state, players: { ...state.players, u1: { ...state.players['u1']!, coins: 0 } } }
    const start = state.players['u1']!.position
    let steps = 1
    let targetCell = getCell((start + steps) % 74)
    while (!isPropertyCell(targetCell) && steps < 74) {
      steps += 1
      targetCell = getCell((start + steps) % 74)
    }
    state = applyRollDice(state, 'u1', steps)
    const landing = applyResolveLanding(state, 'u1', 2000)
    state = landing.state
    expect(() => applyBuyPropertyDecision(state, 'u1', true, 2000)).toThrow(GameActionError)
  })
})

describe('idempotency: repeated submission of the same action should not double-apply', () => {
  it('resolving landing twice throws instead of double-crediting coin effects', () => {
    let state = makeThreePlayerGame()
    state = applyRollDice(state, 'u1', 3)
    const landing = applyResolveLanding(state, 'u1', 2000)
    state = landing.state
    expect(() => applyResolveLanding(state, 'u1', 2000)).toThrow(GameActionError)
  })

  it('ending the same turn twice throws (cannot end turn from ROLLING of the next player using the previous uid)', () => {
    let state = makeThreePlayerGame()
    state = applyRollDice(state, 'u1', 3)
    const landing = applyResolveLanding(state, 'u1', 2000)
    state = resolvePendingDecisionIfAny(landing.state, 'u1', 'u1')
    state = applyAdvanceAfterLanding(state, 'u1', 2000)
    if (state.turn.phase === 'ROLLING') {
      state = applyRollDice(state, 'u1', 2)
      const l2 = applyResolveLanding(state, 'u1', 2000)
      state = resolvePendingDecisionIfAny(l2.state, 'u1', 'u1')
      state = applyAdvanceAfterLanding(state, 'u1', 2000)
    }
    const reveal = applyRevealLadyCard(state, 'u1', 'lady-2', 2000)
    state = reveal.state
    state = applySkipTactic(state, 'u1', 2000)
    state = applyEndTurn(state, 'u1', 2000)
    expect(state.turn.currentPlayerUid).toBe('u2')
    // u1 trying to end turn again now fails because it is not their turn
    expect(() => applyEndTurn(state, 'u1', 2000)).toThrow(GameActionError)
  })
})
