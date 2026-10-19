import React from "react";
import { Check } from "lucide-react";
import styles from "./ProfileSelect.module.css";

interface ProfileSelectOptionProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: () => void;
}

export const ProfileSelectOption: React.FC<ProfileSelectOptionProps> = ({
  id,
  icon,
  label,
  isSelected,
  isHighlighted,
  onSelect,
}) => (
  <button
    id={id}
    type="button"
    tabIndex={-1}
    className={`${styles.option} ${isSelected ? styles.optionSelected : ""} ${isHighlighted ? styles.optionHighlighted : ""}`}
    onClick={onSelect}
    role="option"
    aria-selected={isSelected}
  >
    <div className={styles.optionContent}>
      {icon}
      <span className={styles.optionText}>{label}</span>
    </div>
    {isSelected && <Check size={15} className={styles.checkIcon} />}
  </button>
);
