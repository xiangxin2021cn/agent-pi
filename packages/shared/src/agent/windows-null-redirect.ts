/**
 * Windows NUL / reserved-device helpers.
 *
 * Git Bash on Windows does not treat `nul` as the NUL device. Agents often
 * emit cmd.exe idioms (`del foo 2>nul`), which create a regular file named
 * `nul` in the working directory. `/dev/null` is the correct discard target
 * under bash (including Git Bash).
 */

import { basename } from 'node:path';

const WINDOWS_RESERVED_DEVICE_NAME =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.[^./\\:*?"<>|]+)?$/i;

/** Redirects whose target is the Windows NUL device (quoted, ./nul, nul:, or nul.ext). */
const WINDOWS_NUL_REDIRECT =
  /([0-9]*|&)?(>>?)\s*(['"]?)(?:\.[/\\])?nul(?::|\.[A-Za-z0-9]+)?\3(?=[\s;&|()]|$)/gi;

export function isWindowsReservedDeviceName(name: string): boolean {
  return WINDOWS_RESERVED_DEVICE_NAME.test(name.trim());
}

export function isWindowsReservedDevicePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const name = basename(normalized);
  return isWindowsReservedDeviceName(name);
}

export function isDiscardRedirectTarget(target: string | undefined | null): boolean {
  if (!target) return false;
  const trimmed = target.trim().replace(/^['"]|['"]$/g, '');
  if (trimmed === '/dev/null' || trimmed.toLowerCase() === '$null') return true;
  return isWindowsReservedDeviceName(trimmed) || isWindowsReservedDevicePath(trimmed);
}

/**
 * Rewrite `>nul` / `2>nul` / `&>nul` (and quoted / extension variants) to
 * `/dev/null` so bash does not create a `nul` file in cwd.
 */
export function rewriteWindowsNullRedirects(command: string): string {
  WINDOWS_NUL_REDIRECT.lastIndex = 0;
  return command.replace(WINDOWS_NUL_REDIRECT, '$1$2/dev/null');
}

export function avoidWindowsReservedFilename(name: string): string {
  if (!name) return name;
  if (isWindowsReservedDeviceName(name)) return `_${name}`;
  return name;
}
