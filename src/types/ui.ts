import React from "react";

export const AlertType = {
  SUCCESS: "success",
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
} as const;

export type AlertType = (typeof AlertType)[keyof typeof AlertType];

export const BadgeVariant = {
  ACTIVE: "active",
  DEV: "dev",
  PLANNED: "planned",
} as const;

export type BadgeVariant = (typeof BadgeVariant)[keyof typeof BadgeVariant];

export const ButtonVariant = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
  GHOST: "ghost",
} as const;

export type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant];

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: ButtonVariant;
  isDisabled?: boolean;
}

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export interface FormFieldProps {
  id?: string;
  label: string;
  icon?: React.ElementType;
  type?: "text" | "password" | "number" | "email";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isFullWidth?: boolean;
  className?: string;
}

export interface AlertMessageProps {
  type: AlertType;
  text: string;
  className?: string;
}

export interface ColumnsListProps {
  columns: string[];
  totalRows?: number | null;
  title?: string;
  className?: string;
}

export interface FilterTabsProps {
  categories: string[];
  activeCategory: string;
  onSelectCategory: (category: string) => void;
}

export interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalFilteredCount: number;
  startIndex: number;
  endIndex: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export interface QueryProviderProps {
  children: React.ReactNode;
}
