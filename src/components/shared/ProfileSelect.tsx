import React, { useState, useRef, useEffect } from "react";
import { Plus, Bookmark, ChevronDown, Check } from "lucide-react";
import type { SavedDbProfile } from "@/types/db";
import styles from "./ProfileSelect.module.css";

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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  const handleSelect = (profileId: string) => {
    onSelectProfile(profileId);
    setIsOpen(false);
  };

  return (
    <div className={styles.container} ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
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
              <span className={styles.triggerText}>Nueva conexión (ingresar datos vacíos)...</span>
            </>
          )}
        </div>
        <ChevronDown size={16} className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""}`} />
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="listbox" tabIndex={-1}>
          <button
            type="button"
            className={`${styles.option} ${!activeProfileId ? styles.optionSelected : ""}`}
            onClick={() => handleSelect("")}
            role="option"
            aria-selected={!activeProfileId}
          >
            <div className={styles.optionContent}>
              <Plus size={15} color="var(--accent-cyan)" />
              <span className={styles.optionText}>Nueva conexión (ingresar datos vacíos)...</span>
            </div>
            {!activeProfileId && <Check size={15} className={styles.checkIcon} />}
          </button>

          {profiles.map((profile) => {
            const isSelected = profile.id === activeProfileId;
            return (
              <button
                key={profile.id}
                type="button"
                className={`${styles.option} ${isSelected ? styles.optionSelected : ""}`}
                onClick={() => handleSelect(profile.id)}
                role="option"
                aria-selected={isSelected}
              >
                <div className={styles.optionContent}>
                  <Bookmark size={15} color="var(--accent-cyan)" />
                  <span className={styles.optionText}>{profile.name}</span>
                </div>
                {isSelected && <Check size={15} className={styles.checkIcon} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
