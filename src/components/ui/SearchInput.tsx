import React from "react";
import { Search } from "lucide-react";
import type { SearchInputProps } from "@/types/ui";
import styles from "./SearchInput.module.css";

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = "Buscar...",
  className = "",
}) => {
  return (
    <div className={`${styles.searchBox} ${className}`}>
      <Search size={16} className={styles.icon} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};
