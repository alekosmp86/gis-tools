"use client";

import { useSyncExternalStore } from "react";
import { extensionRegistry } from "@/services/extensions/extensionRegistry";
import type { FileSourceTabExtension, SupportedExtensionFormat } from "@/types/extensions";

const EMPTY_EXTENSIONS: FileSourceTabExtension[] = [];

/**
 * Hook providing all active file source tab extensions registered for a given tool and format.
 * Utilizes React's official useSyncExternalStore for tear-free, render-safe subscriptions.
 */
export function useFileSourceExtensions(
  toolId: string,
  format: SupportedExtensionFormat
): FileSourceTabExtension[] {
  return useSyncExternalStore(
    (callback) => extensionRegistry.subscribe(callback),
    () => extensionRegistry.getFileSourceTabs(toolId, format),
    () => EMPTY_EXTENSIONS
  );
}
