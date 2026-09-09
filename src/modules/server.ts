/**
 * Server Modules Registry
 * Entry point where optional application modules register their backend API route handlers.
 * Strictly server-side: imports zero React components, JSX, or client hooks.
 */

import { moduleRegistry } from "@/services/extensions/moduleRegistry";
import {
  GET as cartographyWatcherGet,
  POST as cartographyWatcherPost,
} from "./cartography-watcher/api/route";

let isServerInitialized = false;

export function initializeServerModules(): void {
  if (isServerInitialized) {
    return;
  }
  isServerInitialized = true;

  // Register module API route handlers
  moduleRegistry.registerApi("cartography-watcher", {
    GET: cartographyWatcherGet,
    POST: cartographyWatcherPost,
  });
}
