export const FISCAL_LIMIT = 35_000;
export const FISCAL_WARNING = 28_000;
export type FiscalFill = {
  id: string;
  time: number;
  mode: "PAPER" | "REAL";
  side: "buy" | "sell";
  pair: string;
  usd: number;
  brlRate: number | null;
};
export const brazilMonth = (time: number) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(time);
export function fiscalSummary(fills: FiscalFill[], mode: "PAPER" | "REAL", now: number) {
  const month = brazilMonth(now);
  const rows = fills.filter((f) => f.mode === mode && brazilMonth(f.time) === month);
  const total = rows.reduce(
    (sum, f) => sum + (f.brlRate && f.brlRate > 0 ? f.usd * f.brlRate : 0),
    0,
  );
  const pending = rows.filter((f) => f.brlRate === null).length;
  return {
    month,
    total,
    pending,
    count: rows.length,
    remaining: Math.max(0, FISCAL_LIMIT - total),
    progress: Math.min(100, (total / FISCAL_LIMIT) * 100),
    threshold: total >= FISCAL_LIMIT ? 100 : total >= FISCAL_WARNING ? 80 : 0,
  };
}
export function appendFiscal(fills: FiscalFill[], fill: FiscalFill) {
  if (fills.some((f) => f.id === fill.id) || !Number.isFinite(fill.usd) || fill.usd <= 0)
    return fills;
  return [...fills, fill];
}
