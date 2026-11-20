"use client";

import React from "react";
import { Map as MapIcon, type LucideIcon } from "lucide-react";
import styles from "./ShowOnMapButton.module.css";

const ICON_SIZE = 15;
const LABEL = "Ver en mapa";

export interface ShowOnMapButtonProps {
  onShow: () => void;
  /** The button's name, when the map opens for something other than showing a row. */
  label?: string;
  icon?: LucideIcon;
}

/** Focuses itself before opening the map, so the dialog can give focus back to this row when it closes. */
export function ShowOnMapButton({ onShow, label = LABEL, icon: Icon = MapIcon }: ShowOnMapButtonProps) {
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true });
    onShow();
  };
  return (
    <button type="button" className={styles.iconButton} onClick={handleClick} aria-haspopup="dialog" aria-label={label} title={label}>
      <Icon size={ICON_SIZE} />
    </button>
  );
}
