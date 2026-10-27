import { RELATION_FACT_KIND, RELATION_KIND, type RelationFactKind } from "../constants";

export interface RelationFactIssueInput {
  kind: RelationFactKind;
  name: string;
}

const RELATION_KIND_TEXT: ReadonlyMap<string, string> = new Map([
  ["v", "una vista"],
  ["m", "una vista materializada"],
  ["f", "una tabla foránea"],
]);
const NON_TABLE_KIND_TEXT = "un objeto que no es una tabla";
const FACT_ISSUE_TEXT = {
  [RELATION_FACT_KIND.TRIGGER]: "triggers",
  [RELATION_FACT_KIND.RULE]: "reglas de reescritura",
} as const;
const WORK_TABLE_KINDS: readonly string[] = [RELATION_KIND.TABLE, RELATION_KIND.PARTITIONED];

export function relationKindIssues(label: string, relkind: string | undefined): string[] {
  if (relkind === undefined || WORK_TABLE_KINDS.includes(relkind)) return [];
  const kindText = RELATION_KIND_TEXT.get(relkind) ?? NON_TABLE_KIND_TEXT;
  return [`La tabla de trabajo ${label} es ${kindText}: debe ser una tabla regular o partitionada.`];
}

function factIssueOf(label: string, facts: readonly RelationFactIssueInput[], kind: RelationFactKind): string[] {
  const names = facts.filter((fact) => fact.kind === kind).map((fact) => fact.name);
  if (names.length === 0) return [];
  return [
    `La tabla de trabajo ${label} tiene ${FACT_ISSUE_TEXT[kind]} (${names.join(", ")}): quítelos antes de actualizar, el proceso no escribe en tablas con ellos.`,
  ];
}

export function relationFactIssues(label: string, facts: readonly RelationFactIssueInput[]): string[] {
  return [...factIssueOf(label, facts, RELATION_FACT_KIND.TRIGGER), ...factIssueOf(label, facts, RELATION_FACT_KIND.RULE)];
}
