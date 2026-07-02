import { describe, expect, test } from 'bun:test';
import { accountToCredentialId, credentialIdToAccount } from '../types.ts';

describe('document provider credential IDs', () => {
  test('stores MinerU tokens as workspace-scoped document credentials', () => {
    const id = {
      type: 'document_api_token' as const,
      workspaceId: 'workspace-1',
      name: 'mineru',
    };

    const account = credentialIdToAccount(id);
    expect(account).toBe('document_api_token::workspace-1::mineru');
    expect(accountToCredentialId(account)).toEqual(id);
  });
});
