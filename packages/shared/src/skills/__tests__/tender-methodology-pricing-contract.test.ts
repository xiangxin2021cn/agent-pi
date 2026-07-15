import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readSkill(slug: string): string {
  return readFileSync(resolve(process.cwd(), '.agents', 'skills', slug, 'SKILL.md'), 'utf8')
}

describe('tender specialist skill contracts', () => {
  test('methodology skill names the formal deliverable and binds it to approved project planning', () => {
    const content = readSkill('tender-execution-planning')
    expect(content).toContain('WORK PLAN AND PROPOSED METHODOLOGY')
    expect(content).toContain('approved project-planning basis')
    expect(content).toContain('formal proposal narrative')
  })

  test('pricing skill requires a five-step build-up for every BOQ item', () => {
    const content = readSkill('tender-cost-cashflow-planning')
    expect(content).toContain('Five-Step BOQ Item Build-Up')
    expect(content).toContain('Every BOQ item')
    expect(content).toContain('Scope and quantity basis')
    expect(content).toContain('Method and productivity')
    expect(content).toContain('Resource consumption')
    expect(content).toContain('Sourced rates and direct cost')
    expect(content).toContain('Reconciliation, conditions, and risk')
  })
})
