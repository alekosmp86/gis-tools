"use client";

import React, { createContext, useContext } from "react";
import type { FileSourceSlotValue } from "./contracts";

/**
 * Carries a host's file source context down to the contributions rendered in its slot.
 *
 * The shape itself lives in `contracts.ts` beside the other module UI contracts, so this file
 * exports only what renders.
 */
const FileSourceSlotContext = createContext<FileSourceSlotValue | null>(null);

interface FileSourceSlotProviderProps {
  value: FileSourceSlotValue;
  children: React.ReactNode;
}

export const FileSourceSlotProvider: React.FC<FileSourceSlotProviderProps> = ({
  value,
  children,
}) => (
  <FileSourceSlotContext.Provider value={value}>{children}</FileSourceSlotContext.Provider>
);

/**
 * Reads the host's file source context.
 *
 * Throws when used outside a provider: a picker rendered with nowhere to return its file is a
 * programming error, and failing loudly beats silently dropping the selection. The slot's error
 * boundary catches it, so the host page survives.
 */
export function useFileSourceSlot(): FileSourceSlotValue {
  const value = useContext(FileSourceSlotContext);

  if (!value) {
    throw new Error(
      "useFileSourceSlot debe usarse dentro de un FileSourceSlotProvider. La contribución se está renderizando fuera del slot de fuentes de archivo."
    );
  }

  return value;
}
