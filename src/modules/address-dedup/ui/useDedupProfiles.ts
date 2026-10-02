"use client";

import { startTransition, useEffect, useState } from "react";
import {
  loadDbProfilesFromLocalStorage,
  saveDbProfileToLocalStorage,
} from "@/core/services/localStorageDbConfig";
import type { DbConfig, SafeDbConfig, SavedDbProfile } from "@/core/types/db";

/** Saved connection profiles. The password is never part of a profile. */
export function useDedupProfiles() {
  const [profiles, setProfiles] = useState<SavedDbProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");

  useEffect(() => {
    const storedProfiles = loadDbProfilesFromLocalStorage();
    startTransition(() => setProfiles(storedProfiles));
  }, []);

  const selectProfile = (profileId: string): SafeDbConfig | null => {
    setActiveProfileId(profileId);
    return profiles.find((profile) => profile.id === profileId)?.config ?? null;
  };

  const saveProfile = (config: DbConfig) => {
    const updatedProfiles = saveDbProfileToLocalStorage(config, undefined, activeProfileId || undefined);
    setProfiles(updatedProfiles);
    setActiveProfileId(updatedProfiles[0]?.id ?? "");
  };

  return { profiles, activeProfileId, selectProfile, saveProfile };
}
