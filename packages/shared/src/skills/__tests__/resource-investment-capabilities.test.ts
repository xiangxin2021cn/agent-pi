import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILLS = [
  ['resource-investment-mandate-screening', 'mandate_screening'],
  ['resource-investment-technical-diligence', 'resource_technical'],
  ['resource-investment-market-offtake', 'market_offtake'],
  ['resource-investment-legal-esg', 'legal_esg'],
  ['resource-investment-financial-valuation', 'financial_valuation'],
  ['resource-investment-transaction-decision', 'transaction_decision'],
] as const;

describe('Resource Investment Intelligence capability skills', () => {
  for (const [slug, capability] of SKILLS) {
    test(`${slug} stays inside the investment plugin boundary`, () => {
      const skill = loadSkillBySlug(PROJECT_ROOT, slug, PROJECT_ROOT);
      expect(skill).not.toBeNull();
      expect(skill!.source).toBe('project');
      expect(skill!.content).toContain('Use `investment_capability`');
      expect(skill!.content).toContain(`\`${capability}\``);
      expect(skill!.content).toContain('Do not scan the working directory.');
      expect(skill!.content).toContain('Do not read Tender Workspace or Delivery Workspace private files.');
      expect(skill!.content).toContain('knowledge snapshot');
      expect(skill!.content).toContain('active direct investment evidence');
      expect(skill!.content).toMatch(/call `validate`/i);
    });
  }
});
