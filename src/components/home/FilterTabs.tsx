import React from "react";
import type { FilterTabsProps } from "@/types/ui";
import styles from "./FilterTabs.module.css";

export const FilterTabs: React.FC<FilterTabsProps> = ({
  categories,
  activeCategory,
  onSelectCategory,
}) => {
  return (
    <div className={styles.filterGroup}>
      {categories.map((cat) => (
        <button
          key={cat}
          className={`${styles.filterBtn} ${
            activeCategory === cat ? styles.filterActive : ""
          }`}
          onClick={() => onSelectCategory(cat)}
        >
          {cat}
        </button>
      ))}
    </div>
  );
};
