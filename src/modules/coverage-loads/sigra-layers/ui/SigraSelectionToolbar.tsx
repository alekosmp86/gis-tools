"use client";

import React from "react";
import { CheckCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import shared from "./SigraShared.module.css";

interface SigraSelectionToolbarProps {
  isBusy: boolean;
  onRefresh: () => void;
  onSelectAll: () => void;
  onSelectRequiredOnly: () => void;
}

export const SigraSelectionToolbar: React.FC<SigraSelectionToolbarProps> = ({
  isBusy,
  onRefresh,
  onSelectAll,
  onSelectRequiredOnly,
}) => (
  <div className={shared.toolbar}>
    <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={isBusy} onClick={onRefresh}>
      <RefreshCw size={15} />
      Actualizar estado
    </Button>
    <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={isBusy} onClick={onSelectAll}>
      <CheckCheck size={15} />
      Seleccionar todas
    </Button>
    <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={isBusy} onClick={onSelectRequiredOnly}>
      <ShieldCheck size={15} />
      Solo obligatorias
    </Button>
  </div>
);
