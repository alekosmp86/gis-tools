export function yieldToMainThread(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
