"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { ShpStepCard } from "./ShpStepCard";
import type { ShpFlow } from "./useShpFlow";
import shared from "./ShpShared.module.css";

interface ShpUploadStepProps {
  flow: ShpFlow;
}

export const ShpUploadStep: React.FC<ShpUploadStepProps> = ({ flow }) => (
  <ShpStepCard title="Subiendo el archivo">
    <div className={shared.stack}>
      <ProgressBar phase={flow.state.file?.name ?? "Archivo SHP"} current={0} total={0} pct={flow.state.uploadPercent} />
      <div className={shared.actions}>
        <Button type="button" variant={ButtonVariant.SECONDARY} onClick={flow.cancelUpload}>
          <X size={15} />
          Cancelar subida
        </Button>
      </div>
    </div>
  </ShpStepCard>
);
