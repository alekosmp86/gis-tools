"use client";

import React from "react";
import { ClipboardCheck } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType } from "@/ui-kit/types/ui";
import { FILE_KINDS, FILE_KIND_LABELS } from "../client";
import { assignFileSlots } from "../domain/fileSlots";
import type { AvanceFtthFlow } from "./useAvanceFtthFlow";
import { AvanceFileDropzone } from "./AvanceFileDropzone";
import { AvanceFileList } from "./AvanceFileList";
import { AvanceStepCard } from "./AvanceStepCard";
import shared from "./AvanceShared.module.css";

interface AvanceFilesStepProps {
  flow: AvanceFtthFlow;
}

function describePendingFiles(files: ReadonlyArray<File>): string | null {
  if (files.length === 0) return null;
  const { slots, unrecognized } = assignFileSlots(files);
  if (unrecognized.length > 0) return "Hay archivos cuyo nombre no es el de ninguna de las dos planillas.";
  const problem = FILE_KINDS.find((kind) => slots[kind].length !== 1);
  if (problem === undefined) return null;
  return slots[problem].length === 0
    ? `Falta el archivo de ${FILE_KIND_LABELS[problem]}.`
    : `Hay más de un archivo de ${FILE_KIND_LABELS[problem]}.`;
}

export const AvanceFilesStep: React.FC<AvanceFilesStepProps> = ({ flow }) => {
  const pendingProblem = describePendingFiles(flow.state.files);

  return (
    <AvanceStepCard title="Planillas de avance">
      <div className={shared.stack}>
        <AvanceFileDropzone onFilesChosen={flow.addFiles} />
        <AvanceFileList files={flow.state.files} onRemove={flow.removeFile} />
        {pendingProblem && <AlertMessage type={AlertType.WARNING} text={pendingProblem} />}
        {flow.state.error && <AlertMessage type={AlertType.ERROR} text={flow.state.error} />}
        <div className={shared.actions}>
          <Button type="button" isDisabled={!flow.canReview} onClick={() => void flow.review()}>
            <ClipboardCheck size={15} />
            Revisar plan de carga
          </Button>
        </div>
      </div>
    </AvanceStepCard>
  );
};
