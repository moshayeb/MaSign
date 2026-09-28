// What a paid action costs, in model calls (MAS-122).
//
// The budget is the owner's own ($5 a month), so the UI says what a button
// will spend before it is pressed rather than after. The numbers mirror the
// backend: the whole-contract review grades passages in batches of 8, one
// call for the risks and one for the key terms per batch (app/risk_analysis/
// review.py); a question costs one call for the answer and one for the risk
// flags on its retrieved passages (app/api/routes.py). Both are estimates —
// a retry after an unreadable reply costs more — so every label says "about".

export const REVIEW_BATCH_SIZE = 8
export const CALLS_PER_BATCH = 2
export const CALLS_PER_QUESTION = 2
// Compare mode (MAS-62): comparing embedding models asks the same question
// twice, once per profile -- each a full /api/query round trip with its own
// answer + risk call, so the paid-model cost genuinely doubles even though
// embedding itself is free (self-hosted). Stated here so the UI can say so
// before the button is pressed, the same rule as every other paid action.
export const COMPARE_CALLS_PER_QUESTION = CALLS_PER_QUESTION * 2

export function reviewCalls(chunkCount: number): number {
  if (chunkCount <= 0) return 0
  return Math.ceil(chunkCount / REVIEW_BATCH_SIZE) * CALLS_PER_BATCH
}

// "≈ 4 model calls" — the same phrasing everywhere a paid action is offered.
export function formatCalls(calls: number): string {
  return `≈ ${calls} model call${calls === 1 ? '' : 's'}`
}

export function reviewCostLabel(chunkCount: number): string {
  return formatCalls(reviewCalls(chunkCount))
}
