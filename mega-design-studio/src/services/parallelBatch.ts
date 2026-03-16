/**
 * Process items in parallel batches with per-item callbacks.
 * Individual item failures do NOT block the batch — failed items are skipped
 * and reported via onItemError callback.
 *
 * @param items       Array of items to process
 * @param processFn   Async function that processes one item and returns a result
 * @param onItemDone  Called after each individual item completes (for UI updates)
 * @param batchSize   Max concurrent calls per batch (default 4)
 * @param delayMs     Delay between batches to avoid rate limits (default 500ms)
 * @param onItemError Called when an individual item fails (optional)
 */
export async function parallelBatch<T, R>(
  items: T[],
  processFn: (item: T, index: number) => Promise<R>,
  onItemDone?: (result: R, item: T, index: number) => void,
  batchSize = 4,
  delayMs = 500,
  onItemError?: (error: Error, item: T, index: number) => void,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (item, bIdx) => {
        const globalIdx = i + bIdx;
        const result = await processFn(item, globalIdx);
        onItemDone?.(result, item, globalIdx);
        return result;
      })
    );

    // Collect successful results, report failures
    for (let bIdx = 0; bIdx < batchResults.length; bIdx++) {
      const outcome = batchResults[bIdx];
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        const globalIdx = i + bIdx;
        const err = outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
        console.warn(`parallelBatch: item ${globalIdx} failed:`, err.message);
        onItemError?.(err, batch[bIdx], globalIdx);
      }
    }

    // Small delay between batches to avoid rate limits
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return results;
}
