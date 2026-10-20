// Retry only this batch; successful batches are never repeated.
export async function withOneRetry(work) {
  try { return await work(); }
  catch { return work(); }
}
