import React from "react";
import { Database, FileSpreadsheet, Layers } from "lucide-react";
import type { ComparisonIconKind } from "@/types/comparison";

export interface ComparisonIconProps {
  kind: ComparisonIconKind;
  size?: number;
  className?: string;
}

export const ComparisonIcon: React.FC<ComparisonIconProps> = ({
  kind,
  size = 13,
  className,
}) => {
  switch (kind) {
    case "database":
      return <Database size={size} className={className} />;
    case "file":
    case "table":
      return <FileSpreadsheet size={size} className={className} />;
    case "layers":
    default:
      return <Layers size={size} className={className} />;
  }
};
