/**
 * Runs one async step per item, strictly one after the other. A single connection runs one
 * statement at a time and the steps of a transaction depend on the order, so this is deliberate.
 */
export async function mapSequentially<TItem, TResult>(
  items: ReadonlyArray<TItem>,
  step: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = [];
  let chain: Promise<void> = Promise.resolve();
  items.forEach((item, index) => {
    chain = chain.then(() => step(item, index)).then((result) => void results.push(result));
  });
  await chain;
  return results;
}
