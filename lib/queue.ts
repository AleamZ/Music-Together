/**
 * Compute a fractional position to drop an item between two neighbors.
 * `before` = position of the item that should end up ABOVE the moved item.
 * `after`  = position of the item that should end up BELOW the moved item.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return 0;
  if (before == null) return (after as number) - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}
