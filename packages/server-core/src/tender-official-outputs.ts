import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FORMAL_OUTPUTS_DIR_NAME } from '@craft-agent/shared/sessions';

/**
 * Session work products go to Official Outputs — the same rule as
 * `getSessionOutputPath` / `document_artifact`:
 * `{workingDirectory}/Agent Pi Outputs/<sessionId>/…`
 *
 * Tender stage briefs use the parent session id so the workbench tree lists them.
 */
export function tenderOfficialOutputOwnerId(
  sessionId: string | undefined,
  fallbackId: string,
): string {
  const id = sessionId?.trim();
  return id && id.length > 0 ? id : fallbackId;
}

export function tenderOfficialOutputsRoot(workingDirectory: string, ownerId: string): string {
  return join(workingDirectory, FORMAL_OUTPUTS_DIR_NAME, ownerId);
}

export function tenderOfficialOutputsDir(
  workingDirectory: string,
  ownerId: string,
  ...segments: string[]
): string {
  return join(tenderOfficialOutputsRoot(workingDirectory, ownerId), ...segments);
}

export function isSameFilesystemPath(left: string, right: string): boolean {
  const normalize = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
  return normalize(left) === normalize(right);
}

export function copyFileIfNewer(sourcePath: string, destinationPath: string): boolean {
  if (!existsSync(sourcePath)) return false;
  if (isSameFilesystemPath(sourcePath, destinationPath)) return false;
  mkdirSync(dirname(destinationPath), { recursive: true });
  if (existsSync(destinationPath)) {
    try {
      const sourceStat = statSync(sourcePath);
      const destStat = statSync(destinationPath);
      if (destStat.mtimeMs >= sourceStat.mtimeMs && destStat.size === sourceStat.size) {
        return false;
      }
    } catch {
      // fall through and copy
    }
  }
  copyFileSync(sourcePath, destinationPath);
  return true;
}
