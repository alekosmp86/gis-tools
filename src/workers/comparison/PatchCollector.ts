import type { SqlPatchSummary } from "@/types/comparison";

/**
 * PatchCollector.ts
 * Manages accumulation of SQL UPDATE and INSERT statements, preview buffers, and statement counts.
 * Supports a lightweight preview-only mode (collectFullScript = false) for zero-memory initial comparison.
 */
export class PatchCollector {
  private readonly maxPreviewLimit: number;
  private readonly collectFullScript: boolean;
  private readonly updateStatements: string[] = [];
  private readonly insertStatements: string[] = [];
  private readonly updatePreviewStatements: string[] = [];
  private readonly insertPreviewStatements: string[] = [];
  private sqlUpdateCount = 0;
  private sqlInsertCount = 0;

  constructor(maxPreviewLimit = 25, collectFullScript = true) {
    this.maxPreviewLimit = maxPreviewLimit;
    this.collectFullScript = collectFullScript;
  }

  public addUpdate(statement: string): void {
    this.sqlUpdateCount++;
    if (this.updatePreviewStatements.length < this.maxPreviewLimit) {
      this.updatePreviewStatements.push(statement);
    }
    if (this.collectFullScript) {
      this.updateStatements.push(statement);
    }
  }

  public get isPreviewMode(): boolean {
    return !this.collectFullScript;
  }

  public isUpdatePreviewFull(): boolean {
    return this.updatePreviewStatements.length >= this.maxPreviewLimit;
  }

  public isInsertPreviewFull(): boolean {
    return this.insertPreviewStatements.length >= this.maxPreviewLimit;
  }

  public isAllPreviewFull(): boolean {
    return this.isUpdatePreviewFull() && this.isInsertPreviewFull();
  }

  public setTotalCounts(updateCount: number, insertCount: number): void {
    this.sqlUpdateCount = updateCount;
    this.sqlInsertCount = insertCount;
  }

  public addInsert(statement: string): void {
    this.sqlInsertCount++;
    if (this.insertPreviewStatements.length < this.maxPreviewLimit) {
      this.insertPreviewStatements.push(statement);
    }
    if (this.collectFullScript) {
      this.insertStatements.push(statement);
    }
  }

  public toSummary(): SqlPatchSummary {
    return {
      sqlUpdateScript: this.collectFullScript ? this.updateStatements.join("\n") : "",
      sqlInsertScript: this.collectFullScript ? this.insertStatements.join("\n") : "",
      sqlUpdateCount: this.sqlUpdateCount,
      sqlInsertCount: this.sqlInsertCount,
      sqlUpdatePreview: this.updatePreviewStatements.join("\n"),
      sqlInsertPreview: this.insertPreviewStatements.join("\n"),
    };
  }
}
