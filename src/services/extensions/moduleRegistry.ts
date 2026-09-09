import type {
  ModuleApiHandler,
  ModuleToolDefinition,
} from "@/types/moduleRegistry";

/**
 * ModuleRegistry
 * Core service managing registered pluggable module APIs and tools.
 * Agnostic: has zero dependencies on src/modules/*.
 */
class ModuleRegistry {
  private readonly apiHandlers = new Map<string, ModuleApiHandler>();
  private readonly tools = new Map<string, ModuleToolDefinition>();
  private readonly listeners = new Set<() => void>();

  public registerApi(moduleId: string, handler: ModuleApiHandler): () => void {
    this.apiHandlers.set(moduleId, handler);
    this.notify();
    return () => {
      this.apiHandlers.delete(moduleId);
      this.notify();
    };
  }

  public getApi(moduleId: string): ModuleApiHandler | undefined {
    return this.apiHandlers.get(moduleId);
  }

  public registerTool(tool: ModuleToolDefinition): () => void {
    this.tools.set(tool.id, tool);
    this.notify();
    return () => {
      this.tools.delete(tool.id);
      this.notify();
    };
  }

  public getTool(toolId: string): ModuleToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  public getAllTools(): ModuleToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Keep listeners isolated
      }
    });
  }
}

export const moduleRegistry = new ModuleRegistry();
