/**
 * Picking the best-quality encode that still fits a byte budget.
 *
 * Encoding a sticker costs seconds of single-threaded wasm, so the search has
 * to be frugal with attempts. Candidates are supplied in descending quality
 * order and probed by binary search, which finds the best fitting candidate in
 * O(log n) encodes instead of O(n).
 *
 * The search assumes output size is non-increasing along the candidate list.
 * Real encoders are only approximately monotonic, so the result is always a
 * candidate that was actually measured under the budget — never an
 * extrapolation.
 */

export interface EncodeAttempt<TParams> {
  readonly params: TParams;
  readonly index: number;
  readonly data: Uint8Array;
  readonly byteLength: number;
}

export type EncodeFn<TParams> = (params: TParams, index: number) => Promise<Uint8Array>;

export interface BudgetSearchOptions<TParams> {
  /** Candidate parameter sets, highest quality first. */
  readonly candidates: readonly TParams[];
  readonly maxBytes: number;
  readonly encode: EncodeFn<TParams>;
  readonly signal?: AbortSignal;
  /** Called after every measured encode, for progress reporting. */
  readonly onAttempt?: (attempt: EncodeAttempt<TParams>) => void;
}

export interface BudgetSearchSuccess<TParams> {
  readonly status: 'fit';
  readonly best: EncodeAttempt<TParams>;
  /** Every encode performed, in the order it ran. */
  readonly attempts: readonly EncodeAttempt<TParams>[];
}

export interface BudgetSearchOverBudget<TParams> {
  readonly status: 'over-budget';
  /** The smallest output produced, so the caller can still offer it. */
  readonly smallest: EncodeAttempt<TParams>;
  readonly attempts: readonly EncodeAttempt<TParams>[];
}

export type BudgetSearchResult<TParams> =
  | BudgetSearchSuccess<TParams>
  | BudgetSearchOverBudget<TParams>;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Encode was cancelled');
  }
}

export async function searchWithinBudget<TParams>(
  options: BudgetSearchOptions<TParams>,
): Promise<BudgetSearchResult<TParams>> {
  const { candidates, maxBytes, encode, signal, onAttempt } = options;

  if (candidates.length === 0) {
    throw new RangeError('searchWithinBudget needs at least one candidate');
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new RangeError(`maxBytes must be a positive finite number, got ${maxBytes}`);
  }

  const attempts: EncodeAttempt<TParams>[] = [];
  const measured = new Map<number, EncodeAttempt<TParams>>();

  const measure = async (index: number): Promise<EncodeAttempt<TParams>> => {
    const cached = measured.get(index);
    if (cached) return cached;

    throwIfAborted(signal);
    const params = candidates[index] as TParams;
    const data = await encode(params, index);
    throwIfAborted(signal);

    const attempt: EncodeAttempt<TParams> = {
      params,
      index,
      data,
      byteLength: data.byteLength,
    };
    measured.set(index, attempt);
    attempts.push(attempt);
    onAttempt?.(attempt);
    return attempt;
  };

  // Lower-bound binary search for the first candidate that fits. Quality falls
  // as the index rises, so the first fitting candidate is the best one.
  let low = 0;
  let high = candidates.length - 1;
  let best: EncodeAttempt<TParams> | undefined;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const attempt = await measure(mid);

    if (attempt.byteLength <= maxBytes) {
      best = attempt;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (best) {
    return { status: 'fit', best, attempts };
  }

  // Nothing fit. The lowest-quality candidate is the smallest one under the
  // monotonicity assumption, but report whichever attempt actually measured
  // smallest so the number shown to the user is a real one.
  const lastIndex = candidates.length - 1;
  if (!measured.has(lastIndex)) {
    await measure(lastIndex);
  }

  let smallest = attempts[0] as EncodeAttempt<TParams>;
  for (const attempt of attempts) {
    if (attempt.byteLength < smallest.byteLength) {
      smallest = attempt;
    }
  }

  return smallest.byteLength <= maxBytes
    ? { status: 'fit', best: smallest, attempts }
    : { status: 'over-budget', smallest, attempts };
}

/**
 * A quality ladder spread evenly between two bounds, best first.
 *
 * Used for encoders whose quality knob is a single number, such as libwebp's
 * `-quality` (0-100, higher is better).
 */
export function qualityLadder(best: number, worst: number, steps: number): readonly number[] {
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError(`steps must be an integer of at least 2, got ${steps}`);
  }

  const ladder: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    ladder.push(Math.round(best + (worst - best) * t));
  }
  return ladder;
}

export function formatBytes(byteLength: number): string {
  if (byteLength < 1000) return `${byteLength} B`;
  const kb = byteLength / 1000;
  if (kb < 1000) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1000).toFixed(1)} MB`;
}
