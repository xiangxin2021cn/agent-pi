// Version is read from the repository root package.json — the single source of truth.
// Workspace package versions can lag behind the app release version.
import pkg from '../../../../package.json';

export const APP_VERSION: string = pkg.version;

export function getAppVersion(): string {
  return APP_VERSION;
}

export * from './install.ts';
export * from './manifest.ts';
export * from './version.ts';
