"use client";

import React from "react";
import { UploadCloud } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType } from "@/ui-kit/types/ui";
import { checkShpFile } from "../domain/shpFileCheck";
import { ShpFileDropzone } from "./ShpFileDropzone";
import { ShpFileSummary } from "./ShpFileSummary";
import { ShpStepCard } from "./ShpStepCard";
import type { ShpFlow } from "./useShpFlow";
import shared from "./ShpShared.module.css";

interface ShpPickStepProps {
  flow: ShpFlow;
}

export const ShpPickStep: React.FC<ShpPickStepProps> = ({ flow }) => {
  const { file, fileError, error } = flow.state;
  const check = file === null ? null : checkShpFile(file);

  return (
    <ShpStepCard title="Archivo SHP">
      <div className={shared.stack}>
        <ShpFileDropzone onFileChosen={flow.pickFile} />
        {file && check?.ok && <ShpFileSummary fileName={file.name} sizeBytes={file.size} target={check.target} />}
        {fileError && <AlertMessage type={AlertType.ERROR} text={fileError} />}
        {error && <AlertMessage type={AlertType.ERROR} text={error} />}
        <div className={shared.actions}>
          <Button type="button" isDisabled={!flow.canUpload} onClick={flow.upload}>
            <UploadCloud size={15} />
            Subir y revisar
          </Button>
        </div>
      </div>
    </ShpStepCard>
  );
};
