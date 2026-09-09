"use client";

import { useEffect, useRef } from "react";
import type { FileSourceTabExtension } from "@/types/extensions";

export interface UseAutoLoadFileSourceParams {
  extensions: readonly FileSourceTabExtension[];
  sourceSlug?: string;
  resourceId?: string;
  hasData: boolean;
  onLoadFile: (file: File) => void;
  onError: (message: string) => void;
  onLoadingChange: (loading: boolean) => void;
}

/**
 * Custom hook to encapsulate the asynchronous auto-loading of a remote cartographic resource.
 */
export function useAutoLoadFileSource({
  extensions,
  sourceSlug,
  resourceId,
  hasData,
  onLoadFile,
  onError,
  onLoadingChange,
}: UseAutoLoadFileSourceParams): void {
  const hasAttemptedRef = useRef(false);

  const onLoadFileRef = useRef(onLoadFile);
  const onErrorRef = useRef(onError);
  const onLoadingChangeRef = useRef(onLoadingChange);

  useEffect(() => {
    onLoadFileRef.current = onLoadFile;
    onErrorRef.current = onError;
    onLoadingChangeRef.current = onLoadingChange;
  });

  useEffect(() => {
    let isCancelled = false;

    if (sourceSlug && resourceId && !hasData && !hasAttemptedRef.current) {
      const extensionWithAutoLoad = extensions.find(
        (extension) => typeof extension.autoLoad === "function"
      );

      if (extensionWithAutoLoad && extensionWithAutoLoad.autoLoad) {
        hasAttemptedRef.current = true;
        const autoLoader = extensionWithAutoLoad.autoLoad;

        const timerId = setTimeout(() => {
          if (!isCancelled) {
            onLoadingChangeRef.current(true);
            autoLoader({ sourceSlug, resourceId })
              .then((file) => {
                if (!isCancelled) {
                  onLoadFileRef.current(file);
                }
              })
              .catch((error: unknown) => {
                if (!isCancelled) {
                  onLoadingChangeRef.current(false);
                  const message =
                    error instanceof Error ? error.message : "Error al cargar archivo remoto.";
                  onErrorRef.current(message);
                }
              });
          }
        }, 0);

        return () => {
          isCancelled = true;
          clearTimeout(timerId);
        };
      }
    }
  }, [extensions, sourceSlug, resourceId, hasData]);
}
