import { describe, expect, test } from 'bun:test';
import {
  TENDER_WRITING_CONTRACT_BRIEF,
  TENDER_WRITING_CONTRACT_DRAFT,
} from './tender-writing-contract.ts';

describe('tender writing contract', () => {
  test('brief text binds tender-grounded writing and strips AI filler', () => {
    expect(TENDER_WRITING_CONTRACT_BRIEF).toContain('THIS tender');
    expect(TENDER_WRITING_CONTRACT_BRIEF).toContain('employer');
    expect(TENDER_WRITING_CONTRACT_BRIEF).toContain('Furthermore');
    expect(TENDER_WRITING_CONTRACT_BRIEF).toContain('综上所述');
    expect(TENDER_WRITING_CONTRACT_BRIEF).toContain('method-theatre');
  });

  test('stage-draft block is a short ban and names the writing skill', () => {
    expect(TENDER_WRITING_CONTRACT_DRAFT).toContain('<tender_writing_contract>');
    expect(TENDER_WRITING_CONTRACT_DRAFT).toContain('[skill:tender-formal-writing]');
    expect(TENDER_WRITING_CONTRACT_DRAFT).toContain('去 AI 味道');
    expect(TENDER_WRITING_CONTRACT_DRAFT.split('\n').length).toBeLessThanOrEqual(16);
  });
});
