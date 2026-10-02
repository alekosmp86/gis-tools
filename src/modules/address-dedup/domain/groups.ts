import type { AnalysisGroup, AnalysisRow } from "../types";

/** Groups the flat rows by `group_id`, preserving the order the query returned them in. */
export function groupRows(rows: ReadonlyArray<AnalysisRow>): AnalysisGroup[] {
  const rowsByGroupId = new Map<number, AnalysisRow[]>();

  for (const row of rows) {
    const members = rowsByGroupId.get(row.group_id);
    if (members) {
      members.push(row);
    } else {
      rowsByGroupId.set(row.group_id, [row]);
    }
  }

  return [...rowsByGroupId].map(([groupId, members]) => ({ groupId, rows: members }));
}
