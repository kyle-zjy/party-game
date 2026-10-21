export class GameActionError extends Error {
  code: 'NOT_YOUR_TURN' | 'INVALID_GAME_ACTION'
  constructor(code: 'NOT_YOUR_TURN' | 'INVALID_GAME_ACTION', message: string) {
    super(message)
    this.code = code
    this.name = 'GameActionError'
  }
}
