"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  FileDown,
  HardDriveDownload,
  Loader2,
} from "lucide-react";
import { useFileSourceSlot } from "@/ui-kit/modules/FileSourceSlotContext";
import { FileSourceFormat } from "@/ui-kit/modules/contracts";
import { formatFileSize, formatPublicationDate } from "../domain/formatters";
import { fetchCatalog, fetchCatalogFile } from "./watcherClient";
import { CatalogFormatFilter } from "../types";
import type { CatalogResourceItem, CatalogSourceGroup } from "../types";
import styles from "./CatalogTreeSelector.module.css";

/**
 * The module's contribution to a sync tool's file source slot.
 *
 * It reads what the host will accept and where to return the chosen file from the slot context,
 * so it never imports the tool it is embedded in — and the tool never imports the module.
 *
 * Groups start collapsed: two datasets of twenty departmental files each is a wall of text if
 * everything is open at once.
 */

/** Maps the host's requested format onto the catalogue's own filter. */
function resolveCatalogFilter(format: FileSourceFormat): CatalogFormatFilter {
  return format === FileSourceFormat.CSV ? CatalogFormatFilter.CSV : CatalogFormatFilter.SHP;
}

/** What one selection needs: the group supplies the dataset, the resource the file. */
interface SelectionRequest {
  group: CatalogSourceGroup;
  resource: CatalogResourceItem;
}

interface CatalogResourceRowProps {
  resource: CatalogResourceItem;
  isBusy: boolean;
  onSelect: (resource: CatalogResourceItem) => void;
}

const CatalogResourceRow: React.FC<CatalogResourceRowProps> = ({
  resource,
  isBusy,
  onSelect,
}) => (
  <li className={styles.resourceRow}>
    <button
      type="button"
      className={styles.resourceButton}
      onClick={() => onSelect(resource)}
      disabled={isBusy}
    >
      <FileDown size={15} className={styles.resourceIcon} />
      <span className={styles.resourceName}>{resource.name}</span>
      <span className={styles.resourceMeta}>
        {resource.format} · {formatFileSize(resource.sizeBytes)} ·{" "}
        {formatPublicationDate(resource.lastModified)}
      </span>
      {resource.isCached && (
        <span className={styles.cachedBadge}>
          <HardDriveDownload size={12} />
          En caché
        </span>
      )}
    </button>
  </li>
);

interface CatalogGroupProps {
  group: CatalogSourceGroup;
  isExpanded: boolean;
  busyResourceId: string | null;
  onToggle: (sourceId: string) => void;
  onSelectResource: (group: CatalogSourceGroup, resource: CatalogResourceItem) => void;
}

const CatalogGroup: React.FC<CatalogGroupProps> = ({
  group,
  isExpanded,
  busyResourceId,
  onToggle,
  onSelectResource,
}) => (
  <li className={styles.group}>
    <button type="button" className={styles.groupHeader} onClick={() => onToggle(group.sourceId)}>
      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      <Database size={16} className={styles.groupIcon} />
      <span className={styles.groupTitle}>{group.title}</span>
      <span className={styles.groupCount}>{group.resources.length}</span>
    </button>

    {isExpanded && (
      <ul className={styles.resourceList}>
        {group.resources.length === 0 ? (
          <li className={styles.emptyGroup}>Sin archivos compatibles en este conjunto de datos.</li>
        ) : (
          group.resources.map((resource) => (
            <CatalogResourceRow
              key={resource.id}
              resource={resource}
              isBusy={busyResourceId === resource.id}
              onSelect={() => onSelectResource(group, resource)}
            />
          ))
        )}
      </ul>
    )}
  </li>
);

export const CatalogTreeSelector: React.FC = () => {
  const queryClient = useQueryClient();
  const { format, onSelectFile, isLoading } = useFileSourceSlot();
  const [expandedSourceIds, setExpandedSourceIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const catalogFilter = resolveCatalogFilter(format);
  const {
    data: groups,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ["cartography-watcher", "catalog", catalogFilter],
    queryFn: () => fetchCatalog(catalogFilter),
  });

  const handleToggleGroup = (sourceId: string) => {
    setExpandedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const selectFileMutation = useMutation({
    mutationFn: ({ group, resource }: SelectionRequest) =>
      fetchCatalogFile(group.datasetSlug, resource.id, resource.name),
    onMutate: () => setExpandedError(null),
    onSuccess: (file) => {
      onSelectFile(file);
      // Fetching a file caches it in the vault, so the cached badges are now out of date.
      queryClient.invalidateQueries({ queryKey: ["cartography-watcher", "catalog"] });
    },
    onError: (selectionFailure: unknown) =>
      setExpandedError(
        selectionFailure instanceof Error
          ? selectionFailure.message
          : "No se pudo obtener el archivo seleccionado."
      ),
  });

  const busyResourceId = selectFileMutation.isPending
    ? (selectFileMutation.variables?.resource.id ?? null)
    : null;

  if (isPending) {
    return (
      <div className={styles.stateArea}>
        <Loader2 size={22} className={styles.spin} />
        <span>Consultando el catálogo cartográfico...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.stateArea}>
        <AlertTriangle size={20} className={styles.errorIcon} />
        <span>
          {error instanceof Error ? error.message : "No se pudo consultar el catálogo."}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <p className={styles.hint}>
        Seleccione un archivo publicado en los catálogos vigilados. Se descarga una sola vez y queda
        en caché para las comparaciones siguientes.
      </p>

      {expandedError && (
        <p className={styles.selectionError}>
          <AlertTriangle size={14} />
          {expandedError}
        </p>
      )}

      <ul className={styles.groupList}>
        {groups.length === 0 ? (
          <li className={styles.emptyGroup}>
            No hay fuentes vigiladas con archivos compatibles.
          </li>
        ) : (
          groups.map((group) => (
            <CatalogGroup
              key={group.sourceId}
              group={group}
              isExpanded={expandedSourceIds.has(group.sourceId)}
              busyResourceId={isLoading ? null : busyResourceId}
              onToggle={handleToggleGroup}
              onSelectResource={(group, resource) =>
                selectFileMutation.mutate({ group, resource })
              }
            />
          ))
        )}
      </ul>
    </div>
  );
};
