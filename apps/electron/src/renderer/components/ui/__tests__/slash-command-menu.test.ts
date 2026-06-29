import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_SLASH_COMMAND_GROUPS,
  getGoalLoopSlashCommandId,
  getGoalLoopModeFromSlashCommandId,
  isGoalSlashCommandId,
} from '../slash-command-menu'

describe('slash command menu', () => {
  it('includes goal loop commands as a first-class menu group', () => {
    const goalGroup = DEFAULT_SLASH_COMMAND_GROUPS.find(group => group.id === 'goal')

    expect(goalGroup?.commands.map(command => command.id)).toEqual([
      'goal-auto-improve',
      'goal-check-only',
      'goal-off',
    ])
  })

  it('maps goal command ids to session goal modes', () => {
    expect(isGoalSlashCommandId('goal-auto-improve')).toBe(true)
    expect(getGoalLoopModeFromSlashCommandId('goal-auto-improve')).toBe('auto_improve')
    expect(getGoalLoopModeFromSlashCommandId('goal-check-only')).toBe('check_only')
    expect(getGoalLoopModeFromSlashCommandId('goal-off')).toBe('off')

    expect(isGoalSlashCommandId('allow-all')).toBe(false)
    expect(getGoalLoopModeFromSlashCommandId('allow-all')).toBeUndefined()

    expect(getGoalLoopSlashCommandId('auto_improve')).toBe('goal-auto-improve')
    expect(getGoalLoopSlashCommandId('check_only')).toBe('goal-check-only')
    expect(getGoalLoopSlashCommandId('off')).toBe('goal-off')
  })
})
