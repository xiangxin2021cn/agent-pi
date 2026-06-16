import { homedir } from 'os';
import { join } from 'path';
import {
  AGENT_PI_CONFIG_ENV,
  APP_CONFIG_DIR_NAME,
  LEGACY_CONFIG_ENV,
} from '../app-defaults.ts';

type EnvLike = Record<string, string | undefined>;

/**
 * Resolve the app configuration directory.
 *
 * Defaults to ~/.agent-pi so this development build does not share state with
 * an installed Craft Agents app. AGENT_PI_CONFIG_DIR is the preferred override;
 * CRAFT_CONFIG_DIR remains supported for existing scripts and tests.
 */
export function resolveConfigDir(env: EnvLike = process.env): string {
  return env[AGENT_PI_CONFIG_ENV] || env[LEGACY_CONFIG_ENV] || join(homedir(), APP_CONFIG_DIR_NAME);
}

export const CONFIG_DIR = resolveConfigDir();
export const CONFIG_DIR_DISPLAY = `~/${APP_CONFIG_DIR_NAME}`;
