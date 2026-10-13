"use client";

import React from "react";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { IndicatorsFlow } from "./useIndicatorsFlow";
import { IndicatorsFileDropzone } from "./IndicatorsFileDropzone";
import { IndicatorsFileList } from "./IndicatorsFileList";
import { IndicatorsStepCard } from "./IndicatorsStepCard";
import shared from "./IndicatorsShared.module.css";

interface IndicatorsFilesStepProps {
  flow: IndicatorsFlow;
}

export const IndicatorsFilesStep: React.FC<IndicatorsFilesStepProps> = ({ flow }) => (
  <IndicatorsStepCard title="2. Archivos de indicadores">
    <div className={shared.stack}>
      <IndicatorsFileDropzone onFilesChosen={flow.addFiles} />
      <IndicatorsFileList files={flow.state.files} onRemove={flow.removeFile} />
      {flow.state.error && <AlertMessage type={AlertType.ERROR} text={flow.state.error} />}
      <div className={shared.actions}>
        <Button type="button" variant={ButtonVariant.SECONDARY} onClick={flow.back}>
          <ArrowLeft size={15} />
          Atrás
        </Button>
        <Button type="button" isDisabled={!flow.canReview} onClick={() => void flow.review()}>
          <ClipboardCheck size={15} />
          Revisar plan de carga
        </Button>
      </div>
    </div>
  </IndicatorsStepCard>
);
