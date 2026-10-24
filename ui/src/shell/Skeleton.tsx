/**
 * Grey blocks in the shape of what a region will hold, while its read is pending (PL-012).
 *
 * A shape, not a sentence: "Loading…" stands where a table will be and moves everything when
 * the table lands. The blocks say nothing to a screen reader; the region around them is
 * `aria-busy`. How each shape looks is in `styles.css`; this says only how many rows of how
 * many blocks it has.
 */

const LAYOUTS = {
  "rank-table": { rows: 8, blocks: 4 },
  "configure-stage": { rows: 4, blocks: 2 },
  "acquire-stats": { rows: 1, blocks: 4 },
  "compare-picker": { rows: 2, blocks: 4 },
  lines: { rows: 3, blocks: 1 },
} as const;

export type SkeletonShape = keyof typeof LAYOUTS;

export function Skeleton({ shape }: { shape: SkeletonShape }) {
  const { rows, blocks } = LAYOUTS[shape];

  return (
    <div className={`skeleton skeleton--${shape}`} aria-hidden="true">
      {Array.from({ length: rows }, (_row, row) => (
        <div key={row} className="skeleton__row">
          {Array.from({ length: blocks }, (_block, block) => (
            <span key={block} className="skeleton__block" />
          ))}
        </div>
      ))}
    </div>
  );
}
