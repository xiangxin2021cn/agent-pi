/**
 * GitHub Copilot OAuth helpers for Pi 0.83+.
 *
 * Pi 0.83 moved Copilot login/refresh off `@earendil-works/pi-ai/oauth`
 * (now type-only) onto provider-owned `OAuthAuth` via `githubCopilotProvider()`.
 */

import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot';
import type { AuthInteraction, OAuthCredential } from '@earendil-works/pi-ai';

function getCopilotOAuth() {
  const oauth = githubCopilotProvider().auth.oauth;
  if (!oauth) {
    throw new Error('GitHub Copilot OAuth is not available from Pi SDK');
  }
  return oauth;
}

/** Run the Copilot device-code login flow (Pi 0.83 AuthInteraction API). */
export async function loginGitHubCopilotOAuth(
  interaction: AuthInteraction,
): Promise<OAuthCredential> {
  return getCopilotOAuth().login(interaction);
}

/**
 * Exchange a GitHub access token (stored as refresh) for a short-lived Copilot API token.
 * Accepts either a refresh-token string or a full OAuth credential.
 */
export async function refreshGitHubCopilotOAuth(
  refreshOrCredential: string | OAuthCredential,
  signal?: AbortSignal,
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
