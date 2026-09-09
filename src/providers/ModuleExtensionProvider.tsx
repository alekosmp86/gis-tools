"use client";

import React, { useEffect } from "react";
import { initializeModules } from "@/modules";

// Eager initialization on module load (both SSR of client components and browser hydration)
initializeModules();

export const ModuleExtensionProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  useEffect(() => {
    initializeModules();
  }, []);

  return <>{children}</>;
};
