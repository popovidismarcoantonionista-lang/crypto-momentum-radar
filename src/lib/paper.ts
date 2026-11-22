import type { Level, Reason } from "@/lib/indicators";

export const PAPER_FEE = 0.001;
export const MIN_VOLUME = 300_000;
export const MAX_SPREAD = 0.0015;
export const DEFAULT_LATENCY_MS = 400;
export const MAX_BOOK_AGE_MS = 10_000;
export type PairRules = { minQuote: number; minBase: number; amountPrecision: number; pricePrecision: number; tradable: boolean; fetchedAt: number };
export type Book = { bids: Level[]; asks: Level[]; bookTime?: number };
export type BlockStatus = "Bloqueada por Liquidez" | "Bloqueada por Spread" | "Bloqueada por Ordem Mínima" | "Livro indisponível" | "Bloqueada por Risco";
export type Check = { ok: true } | { ok: false; status: BlockStatus; reason: string };
export function spreadOf(book: Book): number | null {
  const bid = book.bids[0]?.[0];
  const ask = book.asks[0]?.[0];
  if (!bid || !ask || !Number.isFinite(bid) || !Number.isFinite(ask) || ask < bid) return null;
  return (ask - bid) / bid;
}
export function bookCheck(book: Book, now: number): Check {
  if (spreadOf(book) === null || !book.bookTime || now - book.bookTime > MAX_BOOK_AGE_MS || book.bookTime > now + 1000) return { ok: false, status: "Livro indisponível", reason: "Livro ausente, inválido ou desatualizado" };
  const valid = [...book.bids, ...book.asks].every(([p, q]) => Number.isFinite(p) && p > 0 && Number.isFinite(q) && q > 0);
  if (!valid) return { ok: false, status: "Livro indisponível", reason: "Profundidade inválida" };
  return { ok: true };
}
export function prefilter(book: Book, volume: number, now: number): Check {
  if (!Number.isFinite(volume) || volume < MIN_VOLUME) return { ok: false, status: "Bloqueada por Liquidez", reason: `Volume 24h abaixo de $300k ($${Math.round(volume / 1000)}k)` };
  const valid = bookCheck(book, now);
  if (!valid.ok) return valid;
  const spread = spreadOf(book);
  if (spread === null || spread > MAX_SPREAD + 1e-12) return { ok: false, status: "Bloqueada por Spread", reason: `Spread ${((spread ?? 0) * 100).toFixed(3)}% acima de 0,15%` };
  return { ok: true };
}
export function rewardCheck(tpPct: number, spread: number, slippagePct = 0): Check {
  const cost = PAPER_FEE * 200 + spread * 100 + slippagePct;
  if (!Number.isFinite(tpPct) || tpPct + 1e-10 < 2.5 * cost) return { ok: false, status: "Bloqueada por Risco", reason: `TP ${tpPct}% menor que 2,5× custo (${(2.5 * cost).toFixed(3)}%)` };
  return { ok: true };
}
function rulesCheck(rules: PairRules | undefined, now: number): Check {
  if (!rules || !Number.isFinite(rules.minQuote) || rules.minQuote <= 0 || !Number.isFinite(rules.minBase) || rules.minBase < 0 || !Number.isInteger(rules.amountPrecision) || rules.amountPrecision < 0 || rules.amountPrecision > 12 || now - rules.fetchedAt > 3_600_000 || rules.fetchedAt > now + 1000 || !rules.tradable) return { ok: false, status: "Bloqueada por Ordem Mínima", reason: "Mínimo/precisão do par não confirmado pela Gate.io; operação abortada" };
  return { ok: true };
}
const floorQty = (qty: number, precision: number) => Math.floor(qty * 10 ** precision + 1e-8) / 10 ** precision;
export type Fill = { quantity: number; notional: number; price: number; slippagePct: number };
export function fillQuantity(levels: Level[], quantity: number, side: "buy" | "sell"): Fill | null {
  const ordered = [...levels].sort(([a], [b]) => side === "buy" ? a - b : b - a);
  const first = ordered[0]?.[0];
  if (!first || !Number.isFinite(quantity) || quantity <= 0) return null;
  let left = quantity;
  let notional = 0;
  for (const [price, available] of ordered) {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(available) || available <= 0) return null;
    const taken = Math.min(left, available);
    notional += taken * price;
    left -= taken;
    if (left < quantity * 1e-10) break;
  }
  if (left > quantity * 1e-10) return null;
  const price = notional / quantity;
  return { quantity, notional, price, slippagePct: Math.max(0, (side === "buy" ? price / first - 1 : 1 - price / first) * 100) };
}
export type PaperFill = Fill & { fee: number; debit: number; adjusted: boolean };
export type FillResult = { ok: true; fill: PaperFill } | Extract<Check, { ok: false }>;
export function buyPaper(book: Book, rules: PairRules | undefined, balance: number, intended: number, now: number): FillResult {
  const check = rulesCheck(rules, now);
  if (!check.ok) return check;
  if (!rules) return { ok: false, status: "Bloqueada por Ordem Mínima", reason: "Metadados indisponíveis" };
  const valid = bookCheck(book, now);
  if (!valid.ok) return valid;
  const budget = Math.min(intended, balance / (1 + PAPER_FEE));
  const target = Math.max(budget, rules.minQuote);
  if (!Number.isFinite(balance) || !Number.isFinite(intended) || intended <= 0 || target * (1 + PAPER_FEE) > balance + 1e-9) return { ok: false, status: "Bloqueada por Ordem Mínima", reason: `Saldo insuficiente: mínimo ${rules.minQuote} USDT mais taxa de entrada` };
  let left = target;
  let quantity = 0;
  for (const [price, available] of [...book.asks].sort(([a], [b]) => a - b)) {
    const taken = Math.min(left / price, available);
    quantity += taken;
    left -= taken * price;
    if (left < 1e-9) break;
  }
  if (left > 1e-8) return { ok: false, status: "Livro indisponível", reason: "Profundidade insuficiente para a compra" };
  quantity = floorQty(quantity, rules.amountPrecision);
  let fill = fillQuantity(book.asks, quantity, "buy");
  // Rounding down can put a minimum-sized order below the exchange minimum.
  if (fill && (fill.notional < rules.minQuote - 1e-9 || quantity < rules.minBase)) {
    quantity = Math.max(quantity + 10 ** -rules.amountPrecision, Math.ceil(rules.minBase * 10 ** rules.amountPrecision) / 10 ** rules.amountPrecision);
    fill = fillQuantity(book.asks, quantity, "buy");
  }
  if (!fill || fill.notional < rules.minQuote - 1e-9 || quantity < rules.minBase || fill.notional * (1 + PAPER_FEE) > balance + 1e-9) return { ok: false, status: "Bloqueada por Ordem Mínima", reason: "Mínimo, precisão ou taxa excedem o saldo disponível" };
  const fee = fill.notional * PAPER_FEE;
  return { ok: true, fill: { ...fill, fee, debit: fill.notional + fee, adjusted: fill.notional > intended + 1e-8 } };
}
export function sellPaper(book: Book, rules: PairRules | undefined, quantity: number, now: number): FillResult {
  const check = rulesCheck(rules, now);
  if (!check.ok) return check;
  if (!rules) return { ok: false, status: "Bloqueada por Ordem Mínima", reason: "Metadados indisponíveis" };
  const valid = bookCheck(book, now);
  if (!valid.ok) return valid;
  const sellQty = floorQty(quantity, rules.amountPrecision);
  const fill = fillQuantity(book.bids, sellQty, "sell");
  if (!fill) return { ok: false, status: "Livro indisponível", reason: "Profundidade insuficiente para a venda; posição mantida" };
  if (sellQty < rules.minBase || fill.notional < rules.minQuote - 1e-9) return { ok: false, status: "Bloqueada por Ordem Mínima", reason: "Saída abaixo do mínimo; posição/resíduo mantido" };
  return { ok: true, fill: { ...fill, fee: fill.notional * PAPER_FEE, debit: 0, adjusted: false } };
}
export function paperPnl(notional: number, entryFee: number, quantity: number, exit: number) {
  const proceeds = quantity * exit;
  const exitFee = proceeds * PAPER_FEE;
  const gross = proceeds - notional;
  return { gross, fee: entryFee + exitFee, exitFee, pnl: gross - entryFee - exitFee };
}
export async function afterLatency<T>(latency: number, refresh: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, latency)));
  return refresh();
}
export type ExecutionRecord = { id: string; time: number; pair: string; status: "Executada" | BlockStatus; mode: "PAPER" | "REAL" | "LEGADO"; score: number; reasons: Reason[]; entry?: number; exit?: number; gross?: number; fee?: number; pnl?: number; entryFee?: number; exitFee?: number; reason: string };
export function performance(records: ExecutionRecord[], equity: number[]) {
  const trades = records.filter((r) => r.status === "Executada" && r.pnl !== undefined && r.mode !== "LEGADO");
  const wins = trades.filter((r) => (r.pnl ?? 0) > 0);
  const profit = wins.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  const loss = -trades.filter((r) => (r.pnl ?? 0) < 0).reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  let peak = 0;
  let drawdown = 0;
  for (const value of equity) { peak = Math.max(peak, value); if (peak > 0) drawdown = Math.max(drawdown, (peak - value) / peak * 100); }
  return { count: trades.length, winRate: trades.length ? wins.length / trades.length * 100 : null, fees: records.filter((r) => r.mode !== "LEGADO" && r.status === "Executada").reduce((sum, r) => sum + (r.fee ?? 0), 0), profitFactor: loss > 0 ? profit / loss : profit > 0 ? Infinity : null, drawdown: equity.length > 1 ? drawdown : null };
}
export function nextLosses(previous: number, pnl: number) { return pnl < 0 ? previous + 1 : pnl > 0 ? 0 : previous; }
export function haltReason(pnl: number, start: number, goalPct: number, stopPct: number, losses: number): "meta" | "stop" | "perdas" | null {
  if (start > 0 && pnl <= -start * stopPct / 100 + 1e-9) return "stop";
  if (start > 0 && pnl >= start * goalPct / 100 - 1e-9) return "meta";
  return losses >= 3 ? "perdas" : null;
}