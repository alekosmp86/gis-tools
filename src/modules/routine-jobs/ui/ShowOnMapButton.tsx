"use client";

import React from "react";
import { Map as MapIcon } from "lucide-react";
import styles from "./ShowOnMapButton.module.css";

const ICON_SIZE = 15;
const LABEL = "Ver en mapa";

export interface ShowOnMapButtonProps {
  onShow: () => void;
}

/** Focuses itself before opening the map, so the dialog can give focus back to this row when it closes. */
export function ShowOnMapButton({ onShow }: ShowOnMapButtonProps) {
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true });
    onShow();
  };
  return (
    <button type="button" className={styles.iconButton} onClick={handleClick} aria-haspopup="dialog" aria-label={LABEL} title={LABEL}>
      <MapIcon size={ICON_SIZE} />
    </button>
  );
}
