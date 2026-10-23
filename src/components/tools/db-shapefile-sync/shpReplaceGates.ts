export interface ReplaceGateInput {
  hasTarget: boolean;
  hasFile: boolean;
  sridValid: boolean;
  passwordFilled: boolean;
  processingValid: boolean;
  processingActive: boolean;
  confirmMatches: boolean;
}

export interface ReplaceGates {
  canAnalyze: boolean;
  canRun: boolean;
}

const isBaseReady = (input: ReplaceGateInput): boolean =>
  input.hasTarget && input.hasFile && input.sridValid && input.passwordFilled && input.processingValid;

export function computeReplaceGates(input: ReplaceGateInput): ReplaceGates {
  return {
    canAnalyze: isBaseReady(input) && input.processingActive,
    canRun: isBaseReady(input) && input.confirmMatches,
  };
}
