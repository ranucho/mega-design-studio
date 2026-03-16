import { useState, useCallback, useRef } from 'react';

interface BatchProcessorOptions {
  concurrency?: number;
  delayBetweenBatches?: number;
}

export function useBatchProcessor<T>(options: BatchProcessorOptions = {}) {
  const { concurrency = 2, delayBetweenBatches = 1500 } = options;
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const cancelRef = useRef(false);

  const process = useCallback(async (
    items: T[],
    handler: (item: T, index: number) => Promise<void>
  ) => {
    setIsProcessing(true);
    setTotal(items.length);
    setProcessed(0);
    cancelRef.current = false;

    for (let i = 0; i < items.length; i += concurrency) {
      if (cancelRef.current) break;

      const batch = items.slice(i, i + concurrency);
      await Promise.all(
        batch.map((item, batchIdx) =>
          handler(item, i + batchIdx).then(() => {
            setProcessed(prev => prev + 1);
          }).catch(err => {
            console.error(`Batch item ${i + batchIdx} failed:`, err);
            setProcessed(prev => prev + 1);
          })
        )
      );

      if (i + concurrency < items.length && !cancelRef.current) {
        await new Promise(r => setTimeout(r, delayBetweenBatches));
      }
    }

    setIsProcessing(false);
  }, [concurrency, delayBetweenBatches]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return { process, cancel, processed, total, isProcessing };
}
