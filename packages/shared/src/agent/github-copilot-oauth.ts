/**
 * GitHub Copilot OAuth helpers for Pi 0.83+/0.84+.
 *
 * Pi 0.83 moved Copilot login/refresh off `@earendil-works/pi-ai/oauth`
 * (now type-only) onto provider-owned `OAuthAuth` via `githubCopilotProvider()`.
 * Pi 0.84 requires a concrete AbortSignal on ProviderAuthInteraction / refresh.
 */

import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot';
import type { AuthInteraction, OAuthCredential } from '@earendil-works/pi-ai';

type ProviderAuthInteraction = AuthInteraction & { signal: AbortSignal };

function getCopilotOAuth() {
  const oauth = githubCopilotProvider().auth.oauth;
  if (!oauth) {
    throw new Error('GitHub Copilot OAuth is not available from Pi SDK');
  }
  return oauth;
}

/** Run the Copilot device-code login flow (Pi AuthInteraction API). */
export async function loginGitHubCopilotOAuth(
  interaction: ProviderAuthInteraction,
): Promise<OAuthCredential> {
  return getCopilotOAuth().login(interaction);
}

/**
 * Exchange a GitHub access token (stored as refresh) for a short-lived Copilot API token.
 * Accepts either a refresh-token string or a full OAuth credential.
 * Pi 0.84 requires a concrete AbortSignal; callers may omit it and we use AbortSignal.none.
 */
export async function refreshGitHubCopilotOAuth(
  refreshOrCredential: string | OAuthCredential,
  signal: AbortSignal = new AbortController().signal,
): Promise<OAuthCredential> {
  const credential: OAuthCredential =
    typeof refreshOrCredential === 'string'
      ? {
          type: 'oauth',
          refresh: refreshOrCredential,
          access: '',
          expires: 0,
        }
      : refreshOrCredential;

  return getCopilotOAuth().refresh(credential, signal);
}
