/** Retry only when the failure is a network problem or a temporary gateway error (5xx). */
export async function withRetry<T>(fn: () => Promise<T>, isRetryable: (err: unknown) => boolean, attempts = 3, delayMs = 300): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isRetryable(err)) throw err;
      await new Promise((r) => setTimeout(r, delayMs * 2 ** (i - 1)));
    }
  }
}
