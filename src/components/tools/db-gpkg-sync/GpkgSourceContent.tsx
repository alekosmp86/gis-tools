import React from "react";
import { GpkgUploader } from "./GpkgUploader";
import { GpkgLoadedInfo } from "./GpkgLoadedInfo";
import type { GpkgSource } from "./useGpkgSource";

export interface GpkgSourceContentProps {
  source: GpkgSource;
}

export const GpkgSourceContent: React.FC<GpkgSourceContentProps> = ({ source }) => {
  if (source.file === null) {
    return (
      <GpkgUploader
        isUploading={source.isUploading}
        uploadPct={source.uploadPct}
        errorMessage={source.errorMessage}
        onSelectFile={(file) => void source.selectFile(file)}
      />
    );
  }
  return (
    <GpkgLoadedInfo
      file={source.file}
      layers={source.layers}
      selectedLayer={source.selectedLayer}
      onSelectLayer={source.selectLayer}
      onDiscard={source.discard}
    />
  );
};
