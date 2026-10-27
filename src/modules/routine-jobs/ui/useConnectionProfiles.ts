"use client";

import { startTransition, useEffect, useState } from "react";
import {
  deleteDbProfileFromLocalStorage,
  loadDbProfilesFromLocalStorage,
  saveDbProfileToLocalStorage,
} from "@/core/services/localStorageDbConfig";
import type { SafeDbConfig, SavedDbProfile } from "@/core/types/db";
import { toConnectionProfiles, toStoredConnection, type ConnectionFields } from "./connectionProfiles";

/**
 * Saved connections of the shared store. Only the connection is read or written: the password and
 * the schema/tables never enter a profile, and only the profile the user selected is ever replaced.
 */
export function useConnectionProfiles() {
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

  const saveProfile = (name: string, connection: ConnectionFields) => {
    const trimmedName = name.trim();
    if (trimmedName === "") return;

    const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
    const replacedId = activeProfile?.name === trimmedName ? activeProfile.id : undefined;
    const updatedProfiles = saveDbProfileToLocalStorage(toStoredConnection(connection), trimmedName, replacedId);
    setStoredProfiles(updatedProfiles);
    setActiveProfileId(replacedId ?? updatedProfiles[0]?.id ?? "");
  };

  const deleteProfile = (profileId: string) => {
    setStoredProfiles(deleteDbProfileFromLocalStorage(profileId));
    setActiveProfileId((current) => (current === profileId ? "" : current));
  };

  return { profiles, activeProfileId, selectProfile, saveProfile, deleteProfile };
}
