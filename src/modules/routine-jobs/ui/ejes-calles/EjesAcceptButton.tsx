"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { EJES_ACCEPT_TEXT } from "./ejesAcceptTexts";

const ICON_SIZE = 15;

export interface EjesAcceptButtonProps {
  accepted: boolean;
  onToggle: () => void;
}

/** The row's "Aceptar" toggle: pressing it again takes the acceptance back. */
export const EjesAcceptButton: React.FC<EjesAcceptButtonProps> = ({ accepted, onToggle }) => (
  <Button variant={ButtonVariant.SECONDARY} onClick={onToggle}>
    {accepted ? <X size={ICON_SIZE} /> : <Check size={ICON_SIZE} />}
    <span>{accepted ? EJES_ACCEPT_TEXT.REJECT : EJES_ACCEPT_TEXT.ACCEPT}</span>
  </Button>
);
