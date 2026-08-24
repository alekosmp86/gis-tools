import { useState } from "react";
import type { ColumnMappingConfig, InsertFieldDefault } from "@/types/gis";

export function useSuidMappingForm(
  dbColumns: string[],
  fileAttributes: string[],
  onSuccess: (mappingConfig: ColumnMappingConfig) => void,
  initialConfig?: ColumnMappingConfig | null
) {
  // Allow all non-geometry columns OR geometry columns for SUID/Attribute selection
  const selectableColumns = dbColumns.filter(
    (col) => !["geom", "geometry", "wkb_geometry"].includes(col.toLowerCase())
  );

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

  // Pre-index source file attributes in a Map for fast O(1) lookups
  const fileAttrMap = new Map<string, string>();
  fileAttributes.forEach((attr) => {
    fileAttrMap.set(attr.toLowerCase(), attr);
  });

  // Explicit 1-to-1 DB Column -> File Attribute mapping
  const [customAttributeMap, setCustomAttributeMap] = useState<Record<string, string>>(
    initialConfig?.attributeMap || {}
  );

  // Compute resolved attribute map (custom or auto-detected)
  const attributeMap: Record<string, string> = { ...customAttributeMap };
  dbColumns.forEach((dbCol) => {
    if (attributeMap[dbCol] !== undefined) return; // Keep user custom override

    const targetLower = dbCol.toLowerCase();
    const target10Lower = targetLower.slice(0, 10);

    const matchExact = fileAttrMap.get(targetLower);
    if (matchExact) {
      attributeMap[dbCol] = matchExact;
      return;
    }

    const matchTruncated = fileAttrMap.get(target10Lower);
    if (matchTruncated) {
      attributeMap[dbCol] = matchTruncated;
      return;
    }

    // Check common spatial name aliases (geom vs geom_wkb, geometry vs wkb_geometry)
    if (targetLower.includes("geom")) {
      const fileGeom = fileAttributes.find((attr) => attr.toLowerCase().includes("geom"));
      if (fileGeom) {
        attributeMap[dbCol] = fileGeom;
        return;
      }
    }

    attributeMap[dbCol] = ""; // Unmapped
  });

  // Match selected DB SUID columns to source file attributes
  const matchedFileSuids = selectedSuids.map((suidCol) => {
    if (attributeMap[suidCol]) return attributeMap[suidCol];
    const targetLower = suidCol.toLowerCase();
    const target10Lower = targetLower.slice(0, 10);

    const matchExact = fileAttrMap.get(targetLower);
    if (matchExact) return matchExact;

    const matchTruncated = fileAttrMap.get(target10Lower);
    return matchTruncated || "";
  });

  // Filter out selected SUID columns from available comparison fields (allow all DB columns)
  const suidSet = new Set(selectedSuids);
  const availableCompareFields = dbColumns.filter((col) => !suidSet.has(col));

  // Unmapped DB columns (columns not chosen as SUID or comparison attributes)
  const mappedSet = new Set([...selectedSuids, ...selectedFields]);
  const unmappedDbColumns = dbColumns.filter(
    (col) => !mappedSet.has(col) && !["geom", "geometry", "wkb_geometry"].includes(col.toLowerCase())
  );

  const toggleSuidColumn = (col: string) => {
    setSelectedSuids((prev) => {
      if (prev.includes(col)) {
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

  const handleMapField = (dbCol: string, fileAttr: string) => {
    setCustomAttributeMap((prev) => ({
      ...prev,
      [dbCol]: fileAttr,
    }));
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
      matchedFileSuidColumns: matchedFileSuids,
      fieldsToCompare: selectedFields,
      attributeMap,
      compareGeometry,
      insertDefaults,
    };
    onSuccess(config);
  };

  return {
    selectableColumns,
    selectedSuids,
    matchedFileSuids,
    availableCompareFields,
    selectedFields,
    attributeMap,
    compareGeometry,
    unmappedDbColumns,
    insertDefaults,
    fileAttrMap,
    toggleSuidColumn,
    setCompareGeometry,
    toggleField,
    handleMapField,
    selectAllFields,
    clearAllFields,
    handleUpdateInsertDefault,
    handleProceed,
  };
}
