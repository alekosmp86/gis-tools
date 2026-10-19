import React, { useId } from "react";
import { Plus, Bookmark, ChevronDown } from "lucide-react";
import type { SavedDbProfile } from "@/core/types/db";
import { useProfileSelectSearch } from "../hooks/useProfileSelectSearch";
import { FIRST_PROFILE_INDEX } from "../hooks/profileSelectNavigation";
import { SearchInput } from "./ui/SearchInput";
import { ProfileSelectOption } from "./ProfileSelectOption";
import styles from "./ProfileSelect.module.css";

const NEW_CONNECTION_LABEL = "Nueva conexión (ingresar datos vacíos)...";
const SEARCH_PLACEHOLDER = "Buscar conexión...";

export interface ProfileSelectProps {
  profiles: SavedDbProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
}

export const ProfileSelect: React.FC<ProfileSelectProps> = ({
  profiles,
  activeProfileId,
  onSelectProfile,
}) => {
  const idPrefix = useId();
  const { containerRef, triggerRef, ...search } = useProfileSelectSearch({ profiles, onSelectProfile });
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const optionId = (index: number) => `${idPrefix}-option-${index}`;
  const showEmptyMessage = profiles.length > 0 && search.matchingProfiles.length === 0;

  return (
    <div className={styles.container} ref={containerRef} onKeyDown={search.handleContainerKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${search.isOpen ? styles.triggerOpen : ""}`}
        onClick={search.toggle}
        aria-haspopup="listbox"
        aria-expanded={search.isOpen}
        aria-label="Cargar perfil guardado"
      >
        <div className={styles.triggerContent}>
          {activeProfile ? (
            <>
              <Bookmark size={15} color="var(--accent-cyan)" />
              <span className={styles.triggerText}>{activeProfile.name}</span>
            </>
          ) : (
            <>
              <Plus size={15} color="var(--accent-cyan)" />
              <span className={styles.triggerText}>{NEW_CONNECTION_LABEL}</span>
            </>
          )}
        </div>
        <ChevronDown size={16} className={`${styles.chevron} ${search.isOpen ? styles.chevronOpen : ""}`} />
      </button>

      {search.isOpen && (
        <div className={styles.dropdown}>
          <div className={styles.searchRow}>
            <SearchInput
              compact
              autoFocus
              value={search.query}
              onChange={search.changeQuery}
              onKeyDown={search.handleSearchKeyDown}
              placeholder={SEARCH_PLACEHOLDER}
              ariaLabel="Buscar conexión guardada"
              ariaActiveDescendant={search.activeIndex >= 0 ? optionId(search.activeIndex) : undefined}
            />
          </div>
          <div className={styles.options} role="listbox">
            <ProfileSelectOption
              id={optionId(0)}
              icon={<Plus size={15} color="var(--accent-cyan)" />}
              label={NEW_CONNECTION_LABEL}
              isSelected={!activeProfileId}
              isHighlighted={search.activeIndex === 0}
              onSelect={() => search.select("")}
            />
            {search.matchingProfiles.map((profile, index) => (
              <ProfileSelectOption
                key={profile.id}
                id={optionId(FIRST_PROFILE_INDEX + index)}
                icon={<Bookmark size={15} color="var(--accent-cyan)" />}
                label={profile.name}
                isSelected={profile.id === activeProfileId}
                isHighlighted={search.activeIndex === FIRST_PROFILE_INDEX + index}
                onSelect={() => search.select(profile.id)}
              />
            ))}
          </div>
          {showEmptyMessage && (
            <div className={styles.emptyMessage} role="status">
              Sin resultados para «{search.query.trim()}»
            </div>
          )}
        </div>
      )}
    </div>
  );
};
