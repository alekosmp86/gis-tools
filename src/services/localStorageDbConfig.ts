import type { DbConfig } from "@/types/db";

const STORAGE_KEY = "gis_tools_saved_db_config";

export type SafeDbConfig = Omit<DbConfig, "password">;

/**
 * Saves database connection parameters (excluding password) to localStorage.
 */
export function saveDbConfigToLocalStorage(config: DbConfig): void {
  if (typeof window === "undefined") return;

  const safeConfig: SafeDbConfig = {
    host: config.host,
    port: config.port,
    db_name: config.db_name,
    user: config.user,
    schema_name: config.schema_name,
    table_name: config.table_name,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeConfig));
  } catch (err) {
    console.error("Error saving DB config to localStorage:", err);
  }
}

/**
 * Loads saved database connection parameters from localStorage.
 */
export function loadDbConfigFromLocalStorage(): SafeDbConfig | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SafeDbConfig;
  } catch {
    return null;
  }
}

/**
 * Clears saved database configuration from localStorage.
 */
export function clearDbConfigFromLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error("Error clearing DB config from localStorage:", err);
  }
}
