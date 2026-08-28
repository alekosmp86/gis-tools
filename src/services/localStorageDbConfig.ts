import type { DbConfig, SafeDbConfig, SavedDbProfile } from "@/types/db";

const STORAGE_KEY = "gis_tools_saved_db_profiles_v1";

export function generateDefaultProfileName(config: SafeDbConfig | DbConfig): string {
  const dbName = config.db_name || "db";
  const schema = config.schema_name || "public";
  const table = config.table_name || "tabla";
  const host = config.host ? ` (${config.host})` : "";
  return `${dbName}: ${schema}.${table}${host}`;
}

export function loadDbProfilesFromLocalStorage(): SavedDbProfile[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const profiles = JSON.parse(raw) as SavedDbProfile[];
    return Array.isArray(profiles) ? profiles : [];
  } catch (err) {
    console.error("Error loading DB profiles from localStorage:", err);
    return [];
  }
}

export function saveDbProfileToLocalStorage(
  config: DbConfig,
  customName?: string,
  existingProfileId?: string
): SavedDbProfile[] {
  if (typeof window === "undefined") return [];

  const profiles = loadDbProfilesFromLocalStorage();
  const safeConfig: SafeDbConfig = {
    host: config.host,
    port: config.port,
    db_name: config.db_name,
    user: config.user,
    schema_name: config.schema_name,
    table_name: config.table_name,
  };

  const name = customName?.trim() || generateDefaultProfileName(safeConfig);

  // If updating an existing profile explicitly by ID
  if (existingProfileId) {
    const targetIndex = profiles.findIndex((profile) => profile.id === existingProfileId);
    if (targetIndex !== -1) {
      profiles[targetIndex] = {
        id: existingProfileId,
        name,
        config: safeConfig,
        updatedAt: Date.now(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
      } catch (err) {
        console.error("Error updating DB profile in localStorage:", err);
      }
      return profiles;
    }
  }

  // Otherwise, ALWAYS create a new saved profile
  const newProfile: SavedDbProfile = {
    id: `profile-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name,
    config: safeConfig,
    updatedAt: Date.now(),
  };
  profiles.unshift(newProfile);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.error("Error saving DB profile to localStorage:", err);
  }

  return profiles;
}

export function deleteDbProfileFromLocalStorage(profileId: string): SavedDbProfile[] {
  if (typeof window === "undefined") return [];

  const profiles = loadDbProfilesFromLocalStorage().filter((profile) => profile.id !== profileId);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.error("Error deleting DB profile from localStorage:", err);
  }

  return profiles;
}
