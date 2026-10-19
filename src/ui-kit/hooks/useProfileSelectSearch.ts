import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { SavedDbProfile } from "@/core/types/db";
import { filterByName } from "@/core/common/filterByName";
import {
  FIRST_PROFILE_INDEX,
  NO_HIGHLIGHT,
  highlightAfterArrow,
  highlightAfterQuery,
  resolveEnterSelection,
} from "./profileSelectNavigation";


const KEYS = {
  down: "ArrowDown",
  up: "ArrowUp",
  enter: "Enter",
  escape: "Escape",
} as const;

interface UseProfileSelectSearchArgs {
  profiles: SavedDbProfile[];
  onSelectProfile: (profileId: string) => void;
}

/**
 * State and keyboard behaviour of the searchable saved-connection dropdown.
 * Visible options are the pinned "new connection" entry (index 0) followed by the matching profiles.
 */
export function useProfileSelectSearch({ profiles, onSelectProfile }: UseProfileSelectSearchArgs) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(NO_HIGHLIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const matchingProfiles = filterByName(profiles, query);
  const optionCount = FIRST_PROFILE_INDEX + matchingProfiles.length;
  const activeIndex = Math.min(highlightedIndex, optionCount - 1);

  const close = () => {
    setIsOpen(false);
    setQuery("");
    setHighlightedIndex(NO_HIGHLIGHT);
  };

  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeRef.current();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggle = () => {
    if (isOpen) {
      close();
    } else {
      setIsOpen(true);
    }
  };

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setHighlightedIndex(highlightAfterQuery(nextQuery, filterByName(profiles, nextQuery).length));
  };

  const select = (profileId: string) => {
    onSelectProfile(profileId);
    close();
  };

  const closeAndFocusTrigger = () => {
    close();
    triggerRef.current?.focus();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === KEYS.down || event.key === KEYS.up) {
      event.preventDefault();
      setHighlightedIndex(highlightAfterArrow(activeIndex, event.key, optionCount));
    } else if (event.key === KEYS.enter) {
      event.preventDefault();
      const profileId = resolveEnterSelection(activeIndex, matchingProfiles);
      if (profileId !== null) {
        select(profileId);
      }
    }
  };

  const handleContainerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === KEYS.escape && isOpen) {
      event.stopPropagation();
      closeAndFocusTrigger();
    }
  };

  return {
    isOpen,
    query,
    matchingProfiles,
    activeIndex,
    containerRef,
    triggerRef,
    toggle,
    changeQuery,
    select,
    handleSearchKeyDown,
    handleContainerKeyDown,
  };
}
