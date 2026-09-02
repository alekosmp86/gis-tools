import React from "react";
import { Search, X } from "lucide-react";
import styles from "./SearchInput.module.css";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = "Buscar...",
  className = "",
}) => {
  return (
    <div className={`${styles.searchBox} ${value ? styles.hasValue : ""} ${className}`}>
      <Search size={16} className={styles.icon} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={styles.input}
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          className={styles.clearBtn}
          title="Limpiar búsqueda"
          aria-label="Limpiar búsqueda"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
