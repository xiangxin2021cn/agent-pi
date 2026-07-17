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
    expect(content).toContain('ready user-confirmed `bidder_commitments` pack')
    expect(content).toContain('Treat bidder-confirmed resource, procurement, camp, method, productivity')
    expect(content).toContain('formal proposal narrative')
  })

  test('BOQ pricing skill requires the C5.1 item-level pure direct-cost standard', () => {
    const content = readSkill('tender-boq-five-step-pricing')
    expect(content).toContain('c51_pure_direct_cost_v1')
    expect(content).toContain('Price every selected BOQ item individually')
    expect(content).toContain('at most 12 ordered items')
    expect(content).toContain('optimistic, base, and pessimistic productivity')
    expect(content).toContain('labour, plant, material, subcontract, transport, and waste')
    expect(content).toContain('All rates are VAT exclusive')
    expect(content).toContain('exclude overhead, P&G, profit, general contingency, and escalation')
    expect(content).toContain('A labour/material/equipment database is only a Step 3 rate source')
    expect(content).toContain('full five-step section for every BOQ item')
  })
})
