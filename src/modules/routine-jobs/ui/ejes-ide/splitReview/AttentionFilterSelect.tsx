"use client";

import React from "react";
import { SelectField } from "@/ui-kit/components/ui/SelectField";
import { EJES_SPLIT_ATTENTION_FILTER_TEXT, EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import { ATTENTION_FILTER, type AttentionFilter } from "../ejesIdeReportView";

export interface AttentionFilterSelectProps {
  value: AttentionFilter;
  onChange: (value: AttentionFilter) => void;
}

const ATTENTION_OPTIONS: readonly { value: AttentionFilter; label: string }[] = [
  { value: ATTENTION_FILTER.ALL, label: EJES_SPLIT_ATTENTION_FILTER_TEXT.ALL },
  { value: ATTENTION_FILTER.DECISION, label: EJES_SPLIT_ATTENTION_FILTER_TEXT.DECISION },
  { value: ATTENTION_FILTER.READY, label: EJES_SPLIT_ATTENTION_FILTER_TEXT.READY },
  { value: ATTENTION_FILTER.HELD, label: EJES_SPLIT_ATTENTION_FILTER_TEXT.HELD },
];

/** The attention filter of the split list: all rows, or one attention rank. */
export const AttentionFilterSelect: React.FC<AttentionFilterSelectProps> = ({ value, onChange }) => (
  <SelectField label={EJES_SPLIT_REVIEW_TEXT.FILTER_ATTENTION} value={value} options={ATTENTION_OPTIONS} onChange={onChange} />
);
