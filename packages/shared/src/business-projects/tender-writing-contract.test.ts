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

  test('stage-draft block is chain-wide and bilingual', () => {
    expect(TENDER_WRITING_CONTRACT_DRAFT).toContain('<tender_writing_contract>');
    expect(TENDER_WRITING_CONTRACT_DRAFT).toContain('按本标书专业化写作');
    expect(TENDER_WRITING_CONTRACT_DRAFT).toContain('去 AI 味道');
    expect(TENDER_WRITING_CONTRACT_DRAFT).toContain('writing-contract.md');
  });
});
