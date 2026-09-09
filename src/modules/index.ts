/**
 * Global Modules Registry
 * Entry point where all optional application modules register their extensions.
 */

import { registerCartographyWatcherExtension } from "./cartography-watcher/extension";

let isInitialized = false;

export function initializeModules(): void {
  if (isInitialized) {
    return;
  }
  isInitialized = true;

  // Register optional modules
  registerCartographyWatcherExtension();
}
