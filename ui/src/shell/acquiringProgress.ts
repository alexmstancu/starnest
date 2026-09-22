/**
 * How far through an acquisition is, in words and as a width.
 *
 * A `.tsx` under `shell/` may not call `Number` (`CLAUDE.md`), so the division lives here --
 * and with it the one case that matters: a run whose total is not known yet.
 */
export function acquiringProgress(
  done: number,
  total: number,
): { reading: string; portion: number } {
  if (total <= 0) {
    // **Not "0 of 0".** A run that has not yet said how much there is to do has not failed to
    // do any of it; saying nothing about the count is the honest reading.
    return { reading: "starting", portion: 0 };
  }
  const portion = Math.max(0, Math.min(100, (done / total) * 100));
  return { reading: `${done} of ${total}`, portion };
}
