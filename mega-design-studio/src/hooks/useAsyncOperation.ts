import { useState, useCallback } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

export function useAsyncOperation<T = void>() {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    isLoading: false,
  });

  const execute = useCallback(async (fn: () => Promise<T>): Promise<T | null> => {
    setState({ data: null, error: null, isLoading: true });
    try {
      const result = await fn();
      setState({ data: result, error: null, isLoading: false });
      return result;
    } catch (err: any) {
      const message = err.message || 'An error occurred';
      setState({ data: null, error: message, isLoading: false });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ data: null, error: null, isLoading: false });
  }, []);

  return { ...state, execute, reset };
}
