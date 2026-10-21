import type { LayerLoadStep } from "../types";

export class LoadStepError extends Error {
  readonly step: LayerLoadStep;

  constructor(step: LayerLoadStep, cause: unknown) {
    super(cause instanceof Error ? cause.message : "error desconocido");
    this.name = "LoadStepError";
    this.step = step;
  }
}

export class ValidationRejectedError extends Error {
  constructor(verdictMessage: string) {
    super(verdictMessage);
    this.name = "ValidationRejectedError";
  }
}

export async function inStep<TResult>(step: LayerLoadStep, work: () => Promise<TResult>): Promise<TResult> {
  try {
    return await work();
  } catch (error) {
    throw new LoadStepError(step, error);
  }
}
