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

  const [selectedSuid, setSelectedSuid] = useState<string>(
    initialConfig?.suidColumn || selectableColumns[0] || ""
  );

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

  // Match selected DB SUID to Shapefile attributes
  const matchedShpSuid = useMemo(() => {
    if (!selectedSuid) return "";
    const targetLower = selectedSuid.toLowerCase();
    const target10Lower = targetLower.slice(0, 10);

    const matchExact = shpAttrMap.get(targetLower);
    if (matchExact) return matchExact;

    const matchTruncated = shpAttrMap.get(target10Lower);
    return matchTruncated || "";
  }, [selectedSuid, shpAttrMap]);

  // Filter out SUID from additional comparison fields
  const availableCompareFields = useMemo(() => {
    return selectableColumns.filter((col) => col !== selectedSuid);
  }, [selectableColumns, selectedSuid]);

  // Unmapped DB columns (columns not chosen as SUID or comparison attributes)
  const unmappedDbColumns = useMemo(() => {
    const mappedSet = new Set([selectedSuid, ...selectedFields]);
    return dbColumns.filter(
      (col) => !mappedSet.has(col) && !["geom", "geometry", "wkb_geometry"].includes(col.toLowerCase())
    );
  }, [dbColumns, selectedSuid, selectedFields]);

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
    if (!selectedSuid) return;
    const config: ColumnMappingConfig = {
      suidColumn: selectedSuid,
      matchedShpSuidColumn: matchedShpSuid,
      fieldsToCompare: selectedFields,
      compareGeometry,
      insertDefaults,
    };
    onSuccess(config);
  };

  return {
    selectableColumns,
    selectedSuid,
    matchedShpSuid,
    availableCompareFields,
    selectedFields,
    compareGeometry,
    unmappedDbColumns,
    insertDefaults,
    shpAttrMap,
    setSelectedSuid,
    setCompareGeometry,
    toggleField,
    selectAllFields,
    clearAllFields,
    handleUpdateInsertDefault,
    handleProceed,
  };
}
