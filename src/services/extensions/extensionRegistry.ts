import type { FileSourceTabExtension, SupportedExtensionFormat } from "@/types/extensions";

type RegistryListener = () => void;

class ExtensionRegistry {
  private fileSourceTabs: Map<string, FileSourceTabExtension> = new Map();
  private listeners: Set<RegistryListener> = new Set();
  private cachedFilteredTabs: Map<string, FileSourceTabExtension[]> = new Map();

  /**
   * Registers a new file source extension into the core registry.
   * Returns an unsubscribe function to remove the extension upon unmount or module unload.
   */
  public registerFileSourceTab(extension: FileSourceTabExtension): () => void {
    this.fileSourceTabs.set(extension.id, extension);
    this.cachedFilteredTabs.clear();
    this.notifyListeners();

    return () => {
      this.fileSourceTabs.delete(extension.id);
      this.cachedFilteredTabs.clear();
      this.notifyListeners();
    };
  }

  /**
   * Retrieves all file source tab extensions matching the requested tool ID and spatial format.
   * Returns a cached reference to avoid unnecessary re-renders in useSyncExternalStore.
   */
  public getFileSourceTabs(
    toolId: string,
    format: SupportedExtensionFormat
  ): FileSourceTabExtension[] {
    const cacheKey = `${toolId}:${format}`;
    const cachedResult = this.cachedFilteredTabs.get(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    const matchingExtensions: FileSourceTabExtension[] = [];

    for (const extension of this.fileSourceTabs.values()) {
      const supportsTool = extension.supportedTools.includes(toolId);
      const supportsFormat = extension.supportedFormats.includes(format);

      if (supportsTool && supportsFormat) {
        matchingExtensions.push(extension);
      }
    }

    this.cachedFilteredTabs.set(cacheKey, matchingExtensions);
    return matchingExtensions;
  }

  /**
   * Subscribes to registry changes.
   */
  public subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const extensionRegistry = new ExtensionRegistry();
