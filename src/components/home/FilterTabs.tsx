import React from "react";
import styles from "./FilterTabs.module.css";

export interface FilterTabsProps {
  categories: string[];
  activeCategory: string;
  onSelectCategory: (category: string) => void;
}

export const FilterTabs: React.FC<FilterTabsProps> = ({
  categories,
  activeCategory,
  onSelectCategory,
}) => {
  return (
    <div className={styles.filterGroup}>
      {categories.map((category) => (
        <button
          key={category}
          className={`${styles.filterBtn} ${
            activeCategory === category ? styles.filterActive : ""
          }`}
          onClick={() => onSelectCategory(category)}
        >
          {category}
        </button>
      ))}
    </div>
  );
};
