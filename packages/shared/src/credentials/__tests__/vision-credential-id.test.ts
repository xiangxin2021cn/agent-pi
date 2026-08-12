import { describe, expect, test } from 'bun:test';
import { accountToCredentialId, credentialIdToAccount } from '../types.ts';

describe('vision bridge credential IDs', () => {
  test('stores VLM keys as connection-scoped llm_vision_api_key', () => {
    const id = {
      type: 'llm_vision_api_key' as const,
      connectionSlug: 'deepseek',
    };

    const account = credentialIdToAccount(id);
    expect(account).toBe('llm_vision_api_key::deepseek');
    expect(accountToCredentialId(account)).toEqual(id);
  });
});
