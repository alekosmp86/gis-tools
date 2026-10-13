"use client";

import { startTransition, useEffect, useState } from "react";
import {
  loadDbProfilesFromLocalStorage,
  saveDbProfileToLocalStorage,
} from "@/core/services/localStorageDbConfig";
import type { SafeDbConfig, SavedDbProfile } from "@/core/types/db";
import type { ConnectionPayload } from "../../types";
import {
  connectionProfileName,
  findConnectionProfile,
  toConnectionConfig,
  toConnectionProfiles,
} from "../connectionProfiles";

/**
 * Saved connections. The store is shared with table-oriented tools, so this module only reads it
 * as connection-only entries and never overwrites or deletes another tool's profile. The password
 * is never part of a profile.
 */

function toSafeConfig(connection: ConnectionPayload): SafeDbConfig {
  return {
    host: connection.host,
    port: connection.port,
    db_name: connection.db_name,
    user: connection.user,
    schema_name: "",
    table_name: "",
  };
}

export function useCoverageProfiles() {
  const [storedProfiles, setStoredProfiles] = useState<SavedDbProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const profiles = toConnectionProfiles(storedProfiles);

  useEffect(() => {
    const loadedProfiles = loadDbProfilesFromLocalStorage();
    startTransition(() => setStoredProfiles(loadedProfiles));
  }, []);

  const selectProfile = (profileId: string): SafeDbConfig | null => {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    setActiveProfileId(profile?.id ?? "");
    return profile?.config ?? null;
  };

  const saveProfile = (connection: ConnectionPayload) => {
    if (connection.db_name.trim() === "") return;

    const config = toSafeConfig(connection);
    const existingProfile = findConnectionProfile(profiles, config);
    if (existingProfile) {
      setActiveProfileId(existingProfile.id);
      return;
    }

    const updatedProfiles = saveDbProfileToLocalStorage(
      toConnectionConfig(config),
      connectionProfileName(config)
    );
    setStoredProfiles(updatedProfiles);
    setActiveProfileId(findConnectionProfile(toConnectionProfiles(updatedProfiles), config)?.id ?? "");
  };

  return { profiles, activeProfileId, selectProfile, saveProfile };
}
