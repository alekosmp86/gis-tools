import { useState } from "react";
import type { ColumnMappingConfig } from "@/types/comparison";

export function useSuidMappingForm(
  dbColumns: string[],
  fileAttributes: string[],
  onSuccess: (mappingConfig: ColumnMappingConfig) => void,
  initialConfig?: ColumnMappingConfig | null,
  onReadyChange?: (ready: boolean) => void
) {
  // Allow all non-geometry columns OR geometry columns for SUID/Attribute selection
  const selectableColumns = dbColumns.filter(
    (column) => !["geom", "geometry", "wkb_geometry"].includes(column.toLowerCase())
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

    // Default to self if field name matches loosely or fallback to empty
    const directMatch = fileAttributes.find(
      (fileAttr) => fileAttr.toLowerCase() === targetLower
    );
    if (directMatch) {
      attributeMap[dbCol] = directMatch;
    }
  });

  // Resolve matching File SUID columns (1-to-1 matching for each DB SUID column)
  const matchedFileSuids = selectedSuids.map((suidCol) => {
    if (customAttributeMap[suidCol]) {
      return customAttributeMap[suidCol];
    }
    const targetLower = suidCol.toLowerCase();
    const target10Lower = targetLower.slice(0, 10);

    const matchExact = fileAttrMap.get(targetLower);
    if (matchExact) return matchExact;

    const matchTruncated = fileAttrMap.get(target10Lower);
    return matchTruncated || "";
  });

  // Filter out selected SUID columns from available comparison fields (allow all DB columns)
  const suidSet = new Set(selectedSuids);
  const availableCompareFields = dbColumns.filter((column) => !suidSet.has(column));

  const toggleSuidColumn = (column: string) => {
    setSelectedSuids((prev) => {
      let next: string[];
      if (prev.includes(column)) {
        if (prev.length <= 1) return prev;
        next = prev.filter((item) => item !== column);
      } else {
        next = [...prev, column];
      }
      onReadyChange?.(next.length > 0);
      return next;
    });
  };

  const toggleField = (field: string) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((item) => item !== field) : [...prev, field]
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

  const handleProceed = () => {
    if (selectedSuids.length === 0) return;

    const baseConfig: ColumnMappingConfig = initialConfig ?? {
      suidColumns: [],
      matchedFileSuidColumns: [],
      fieldsToCompare: [],
      compareGeometry: false,
    };

    const config: ColumnMappingConfig = {
      ...baseConfig,
      suidColumns: selectedSuids,
      matchedFileSuidColumns: matchedFileSuids,
      fieldsToCompare: selectedFields,
      attributeMap,
      compareGeometry,
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
    toggleSuidColumn,
    setCompareGeometry,
    toggleField,
    handleMapField,
    selectAllFields,
    clearAllFields,
    handleProceed,
  };
}
