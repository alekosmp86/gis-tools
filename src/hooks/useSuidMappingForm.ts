import { useState, useMemo } from "react";
import type { ColumnMappingConfig, InsertFieldDefault } from "@/types/gis";

export function useSuidMappingForm(
  dbColumns: string[],
  shpAttributes: string[],
  onSuccess: (mappingConfig: ColumnMappingConfig) => void,
  initialConfig?: ColumnMappingConfig | null
) {
  // Filter out geometry columns from SUID selection
  const selectableColumns = useMemo(() => {
    return dbColumns.filter(
      (col) => !["geom", "geometry", "wkb_geometry"].includes(col.toLowerCase())
    );
  }, [dbColumns]);

  const [selectedSuids, setSelectedSuids] = useState<string[]>(() => {
    if (initialConfig?.suidColumns && initialConfig.suidColumns.length > 0) {
      return initialConfig.suidColumns;
    }
    return selectableColumns[0] ? [selectableColumns[0]] : [];
  });

  const [selectedFields, setSelectedFields] = useState<string[]>(
    initialConfig?.fieldsToCompare || []
  );

  const [compareGeometry, setCompareGeometry] = useState<boolean>(
    initialConfig?.compareGeometry ?? false
  );

  const [insertDefaults, setInsertDefaults] = useState<Record<string, InsertFieldDefault>>(
    initialConfig?.insertDefaults || {}
  );

  // Pre-index Shapefile attributes in a Map for fast O(1) lookups
  const shpAttrMap = useMemo(() => {
    const map = new Map<string, string>();
    shpAttributes.forEach((attr) => {
      map.set(attr.toLowerCase(), attr);
    });
    return map;
  }, [shpAttributes]);

  // Match selected DB SUID columns to Shapefile attributes
  const matchedShpSuids = useMemo(() => {
    return selectedSuids.map((suidCol) => {
      const targetLower = suidCol.toLowerCase();
      const target10Lower = targetLower.slice(0, 10);

      const matchExact = shpAttrMap.get(targetLower);
      if (matchExact) return matchExact;

      const matchTruncated = shpAttrMap.get(target10Lower);
      return matchTruncated || "";
    });
  }, [selectedSuids, shpAttrMap]);

  // Filter out selected SUID columns from available comparison fields
  const availableCompareFields = useMemo(() => {
    const suidSet = new Set(selectedSuids);
    return selectableColumns.filter((col) => !suidSet.has(col));
  }, [selectableColumns, selectedSuids]);

  // Unmapped DB columns (columns not chosen as SUID or comparison attributes)
  const unmappedDbColumns = useMemo(() => {
    const mappedSet = new Set([...selectedSuids, ...selectedFields]);
    return dbColumns.filter(
      (col) => !mappedSet.has(col) && !["geom", "geometry", "wkb_geometry"].includes(col.toLowerCase())
    );
  }, [dbColumns, selectedSuids, selectedFields]);

  const toggleSuidColumn = (col: string) => {
    setSelectedSuids((prev) => {
      if (prev.includes(col)) {
        // Don't allow deselecting the last remaining SUID column
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== col);
      }
      return [...prev, col];
    });
  };

  const toggleField = (field: string) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const selectAllFields = () => {
    setSelectedFields([...availableCompareFields]);
  };

  const clearAllFields = () => {
    setSelectedFields([]);
  };

  const handleUpdateInsertDefault = (fieldName: string, fieldDefault: InsertFieldDefault) => {
    setInsertDefaults((prev) => ({
      ...prev,
      [fieldName]: fieldDefault,
    }));
  };

  const handleProceed = () => {
    if (selectedSuids.length === 0) return;

    const config: ColumnMappingConfig = {
      suidColumns: selectedSuids,
      matchedShpSuidColumns: matchedShpSuids,
      fieldsToCompare: selectedFields,
      compareGeometry,
      insertDefaults,
    };
    onSuccess(config);
  };

  return {
    selectableColumns,
    selectedSuids,
    matchedShpSuids,
    availableCompareFields,
    selectedFields,
    compareGeometry,
    unmappedDbColumns,
    insertDefaults,
    shpAttrMap,
    toggleSuidColumn,
    setCompareGeometry,
    toggleField,
    selectAllFields,
    clearAllFields,
    handleUpdateInsertDefault,
    handleProceed,
  };
}
