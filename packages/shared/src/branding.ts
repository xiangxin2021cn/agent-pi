/**
 * Centralized branding assets for Agent π
 * Used by OAuth callback pages
 */

export const CRAFT_LOGO = [
  'Agent π',
] as const;

/** Logo as a single string for HTML templates */
export const CRAFT_LOGO_HTML = CRAFT_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL */
export const VIEWER_URL = 'https://agents.craft.do';
