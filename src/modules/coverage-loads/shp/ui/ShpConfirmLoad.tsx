"use client";

import React from "react";
import styles from "./ShpConfirmLoad.module.css";

interface ShpConfirmLoadProps {
  table: string;
  isChecked: boolean;
  onChange: (value: boolean) => void;
}

export const ShpConfirmLoad: React.FC<ShpConfirmLoadProps> = ({ table, isChecked, onChange }) => (
  <label className={styles.option}>
    <input type="checkbox" checked={isChecked} onChange={(event) => onChange(event.target.checked)} />
    <span>Confirmo que se reemplazará todo el contenido de public.{table} con este archivo.</span>
  </label>
);
