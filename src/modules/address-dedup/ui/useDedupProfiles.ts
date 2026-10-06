"use client";

import { startTransition, useEffect, useState } from "react";
import {
  loadDbProfilesFromLocalStorage,
  saveDbProfileToLocalStorage,
} from "@/core/services/localStorageDbConfig";
import type { DbConfig, SafeDbConfig, SavedDbProfile } from "@/core/types/db";
import {
  connectionProfileName,
  findConnectionProfile,
  toConnectionConfig,
  toConnectionProfiles,
} from "../domain/connectionProfiles";

/**
 * Saved connections. The store is shared with table-oriented tools, so the dedup tool only
 * reads it as connection-only entries and never overwrites or deletes another tool's profile.
 * The password is never part of a profile.
 */
export function useDedupProfiles() {
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

  const saveProfile = (config: DbConfig) => {
    if (config.db_name.trim() === "") return;

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
