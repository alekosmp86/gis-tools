export const SAVEPOINT_REPORT_SQL = "SAVEPOINT avance_report";
export const RELEASE_REPORT_SQL = "RELEASE SAVEPOINT avance_report";
export const ROLLBACK_TO_REPORT_SQL = "ROLLBACK TO SAVEPOINT avance_report";

export const reportTimeoutSql = (milliseconds: number): string => `SET LOCAL statement_timeout = ${milliseconds}`;
