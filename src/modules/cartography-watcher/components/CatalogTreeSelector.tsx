"use client";

import React, { useState, useEffect, useId } from "react";
import {
  Search,
  Folder,
  FolderOpen,
  FileSpreadsheet,
  FileArchive,
  ChevronDown,
  Loader2,
  CheckCircle2,
  Calendar,
  HardDrive,
  ArrowDownToLine,
  ChevronsUpDown,
  Layers,
} from "lucide-react";
import {
  CatalogFormatFilter,
  type CatalogSourceGroup,
  type CatalogResourceItem,
} from "../types/watcher";
import { formatBytes, formatDate } from "../utils/watcherFormatters";
import {
  fetchCatalogTreeApi,
  fetchCatalogFileAsBrowserFile,
} from "../services/watcherApi";
import styles from "./CatalogTreeSelector.module.css";

export interface CatalogTreeSelectorProps {
  acceptedFormat?: CatalogFormatFilter;
  onSelectFile: (
    file: File,
    meta: { resourceId: string; resourceName: string; format: string }
  ) => void;
  isLoadingFile?: boolean;
}

function filterCatalogGroups(
  groups: readonly CatalogSourceGroup[],
  rawQuery: string
): CatalogSourceGroup[] {
  const query = rawQuery.toLowerCase().trim();
  if (!query) {
    return groups as CatalogSourceGroup[];
  }

  const results: CatalogSourceGroup[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    const groupMatches = group.title.toLowerCase().includes(query);
    if (groupMatches) {
      results.push(group);
      continue;
    }

    const matchingResources = group.resources.filter((resource) =>
      resource.name.toLowerCase().includes(query)
    );
    if (matchingResources.length > 0) {
      results.push({
        ...group,
        resources: matchingResources,
      });
    }
  }

  return results;
}

export const CatalogTreeSelector: React.FC<CatalogTreeSelectorProps> = ({
  acceptedFormat = CatalogFormatFilter.ALL,
  onSelectFile,
  isLoadingFile = false,
}) => {
  const searchInputId = useId();
  const [catalogGroups, setCatalogGroups] = useState<CatalogSourceGroup[]>([]);
  const [isLoadingTree, setIsLoadingTree] = useState<boolean>(true);
  const [loadingResourceId, setLoadingResourceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedSlugs, setExpandedSlugs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isCancelled = false;

    fetchCatalogTreeApi(acceptedFormat).then((result) => {
      if (isCancelled) return;
      setIsLoadingTree(false);
      if (result.ok) {
        setCatalogGroups(result.data);
        // All nodes start collapsed by default
        setExpandedSlugs({});
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [acceptedFormat]);

  const toggleGroup = (sourceSlug: string) => {
    setExpandedSlugs((previousState) => ({
      ...previousState,
      [sourceSlug]: !previousState[sourceSlug],
    }));
  };

  const toggleAll = () => {
    const areAllExpanded = catalogGroups.every((group) => expandedSlugs[group.sourceSlug]);
    const newState: Record<string, boolean> = {};
    catalogGroups.forEach((group) => {
      newState[group.sourceSlug] = !areAllExpanded;
    });
    setExpandedSlugs(newState);
  };

  const filteredGroups = filterCatalogGroups(catalogGroups, searchQuery);

  const handleSelectResource = (
    sourceSlug: string,
    resource: CatalogResourceItem
  ) => {
    setLoadingResourceId(resource.id);

    fetchCatalogFileAsBrowserFile(
      sourceSlug,
      resource.id,
      `${resource.name}.${resource.format.toLowerCase()}`
    ).then((result) => {
      setLoadingResourceId(null);
      if (result.ok) {
        onSelectFile(result.data, {
          resourceId: resource.id,
          resourceName: resource.name,
          format: resource.format,
        });
      }
    });
  };

  const renderFileIcon = (format: string) => {
    const upper = format.toUpperCase();
    if (upper === CatalogFormatFilter.CSV) {
      return <FileSpreadsheet size={16} className={styles.resourceIcon} />;
    }
    return <FileArchive size={16} className={styles.resourceIcon} />;
  };

  return (
    <div className={styles.container}>
      {/* Controls Bar */}
      <div className={styles.controlsBar}>
        <div className={styles.searchWrapper}>
          <Search size={16} className={styles.searchIcon} />
          <input
            id={searchInputId}
            type="text"
            className={styles.searchInput}
            placeholder="Buscar por departamento o fuente cartográfica..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className={styles.controlButtons}>
          <button
            type="button"
            className={styles.toggleButton}
            onClick={toggleAll}
            title="Expandir o colapsar todas las fuentes"
          >
            <ChevronsUpDown size={14} />
            <span>Alternar Todo</span>
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoadingTree && (
        <div className={styles.emptyState}>
          <Loader2 size={32} className={`${styles.emptyStateIcon} ${styles.loadingSpinner}`} />
          <div className={styles.emptyStateTitle}>Consultando fuentes cartográficas...</div>
          <div className={styles.emptyStateSubtitle}>
            Obteniendo el catálogo de recursos disponibles en los portales oficiales.
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoadingTree && filteredGroups.length === 0 && (
        <div className={styles.emptyState}>
          <Layers size={32} className={styles.emptyStateIcon} />
          <div className={styles.emptyStateTitle}>No se encontraron recursos</div>
          <div className={styles.emptyStateSubtitle}>
            {searchQuery
              ? `No hay capas que coincidan con "${searchQuery}". Intente con otro término.`
              : "No hay fuentes cartográficas disponibles para este formato."}
          </div>
        </div>
      )}

      {/* Tree View */}
      {!isLoadingTree && filteredGroups.length > 0 && (
        <div className={styles.treeContainer}>
          {filteredGroups.map((group) => {
            const isExpanded = Boolean(expandedSlugs[group.sourceSlug]) || Boolean(searchQuery.trim());

            return (
              <div key={group.sourceSlug} className={styles.groupCard}>
                <button
                  type="button"
                  className={styles.groupHeader}
                  onClick={() => toggleGroup(group.sourceSlug)}
                  aria-expanded={isExpanded}
                >
                  <div className={styles.groupHeaderLeft}>
                    {isExpanded ? (
                      <FolderOpen size={18} className={styles.groupIcon} />
                    ) : (
                      <Folder size={18} className={styles.groupIcon} />
                    )}
                    <span className={styles.groupTitle}>{group.title}</span>
                    <span className={styles.groupCountBadge}>
                      {group.resources.length} {group.resources.length === 1 ? "archivo" : "archivos"}
                    </span>
                  </div>

                  <ChevronDown
                    size={16}
                    className={`${styles.groupChevron} ${
                      isExpanded ? styles.groupChevronOpen : ""
                    }`}
                  />
                </button>

                {isExpanded && (
                  <div className={styles.resourceList}>
                    {group.resources.map((resource) => {
                      const isItemLoading =
                        loadingResourceId === resource.id || (isLoadingFile && loadingResourceId === resource.id);

                      return (
                        <div key={resource.id} className={styles.resourceRow}>
                          <div className={styles.resourceLeft}>
                            {renderFileIcon(resource.format)}
                            <div className={styles.resourceMetaCol}>
                              <div className={styles.resourceName} title={resource.name}>
                                {resource.name}
                              </div>
                              <div className={styles.resourceChips}>
                                <span className={styles.formatBadge}>
                                  {resource.format}
                                </span>
                                {resource.isCached && (
                                  <span className={styles.cachedBadge} title="Disponible al instante desde la caché local">
                                    <CheckCircle2 size={11} />
                                    En caché local
                                  </span>
                                )}
                                <span className={styles.metaText}>
                                  <HardDrive size={11} />
                                  {formatBytes(resource.size)}
                                </span>
                                <span className={styles.metaText}>
                                  <Calendar size={11} />
                                  {formatDate(resource.lastModified)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            className={styles.loadButton}
                            onClick={() => handleSelectResource(group.sourceSlug, resource)}
                            disabled={isItemLoading || isLoadingFile}
                            title={`Cargar ${resource.name} en el asistente`}
                          >
                            {isItemLoading ? (
                              <>
                                <Loader2 size={13} className={styles.loadingSpinner} />
                                <span>Cargando...</span>
                              </>
                            ) : (
                              <>
                                <ArrowDownToLine size={13} />
                                <span>Cargar</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
