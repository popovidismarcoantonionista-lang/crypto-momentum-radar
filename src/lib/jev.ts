import type { Kline, Level, Reason } from "@/lib/indicators";
import { DEFAULT_LATENCY_MS, prefilter, type PairRules } from "@/lib/paper";
import type { TokenIdentity } from "@/lib/leadlag";

export type JevWeights = { volume: number; rsi: number; breakout: number; book: number };
export type JevSettings = {
  trigger: number;
  intervalSeconds: number;
  weights: JevWeights;
  allocation: number;
  handMode: "percent" | "fixed";
  fixedUsdt: number;
  latencyMs: number;
  tp: number;
  sl: number;
  trailTrigger: number;
  trailDistance: number;
  dailyGoalPct: number;
  dailyStopPct: number;
  autoPause: boolean;
};

export const DEFAULT_JEV_SETTINGS: JevSettings = {
  trigger: 85,
  intervalSeconds: 5,
  weights: { volume: 30, rsi: 20, breakout: 25, book: 25 },
  allocation: 1,
  handMode: "percent",
  fixedUsdt: 5,
  latencyMs: DEFAULT_LATENCY_MS,
  tp: 4,
  sl: 2,
  trailTrigger: 1.8,
  trailDistance: 0.8,
  dailyGoalPct: 30,
  dailyStopPct: 10,
  autoPause: true,
};

export type JevMarket = {
  symbol: string;
  price: number;
  change24: number;
  quoteVolume: number;
  klines: Kline[];
  bids: Level[];
  asks: Level[];
  bookTime?: number;
  rules?: PairRules;
  identity?: TokenIdentity;
};

export type JevAnalysis = {
  score: number;
  reasons: Reason[];
  safe: boolean;
  safeReason?: string | undefined;
  change5: number;
  change15: number;
  volumeRatio: number;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const pct = (from: number, to: number) => (from > 0 ? (to / from - 1) * 100 : 0);

export function marketMetrics(klines: Kline[]) {
  const closes = klines.map((k) => k.c);
  const current = closes.at(-1) ?? 0;
  const first15 = klines.slice(-15)[0]?.o ?? current;
  const first5 = klines.slice(-5)[0]?.o ?? current;
  const peak15 = Math.max(...klines.slice(-15).map((k) => k.h), current);
  const last3 = klines.slice(-3);
  const previous = klines.slice(-15, -3);
  const recentVolume = last3.reduce((sum, k) => sum + k.v, 0) / Math.max(1, last3.length);
  const previousVolume = previous.reduce((sum, k) => sum + k.v, 0) / Math.max(1, previous.length);
  return {
    current,
    change5: pct(first5, current),
    change15: pct(first15, current),
    peak15,
    peakGain15: pct(first15, peak15),
    pullback: pct(peak15, current) * -1,
    volumeRatio: previousVolume > 0 ? recentVolume / previousVolume : recentVolume > 0 ? 2 : 0,
  };
}

export function antiTopCheck(klines: Kline[]) {
  const m = marketMetrics(klines);
  if (m.peakGain15 <= 15) return { ok: true as const, reason: "Sem estirão acima de 15% nos últimos 15 minutos" };
  const validPullback = m.pullback >= 1.5 && m.pullback <= 2.5 && m.volumeRatio >= 1;
  if (validPullback) {
    return { ok: true as const, reason: `Pullback válido de ${m.pullback.toFixed(2)}% com retomada de volume` };
  }
  return {
    ok: false as const,
    reason: `anti-topo: alta de ${m.peakGain15.toFixed(1)}% em 15m; aguardando recuo de 1,5%–2,5% com volume (atual ${m.pullback.toFixed(2)}%)`,
  };
}

function rsi7(closes: number[]) {
  if (closes.length < 8) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - 7; i < closes.length; i += 1) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta > 0) gains += delta;
    else losses -= delta;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}

export function scoreJev(market: JevMarket, weights: JevWeights, now = Date.now()): JevAnalysis {
  const filter = prefilter(market, market.quoteVolume, now);
  if (!filter.ok) return { score: 0, reasons: [], safe: false, safeReason: filter.reason, change5: 0, change15: 0, volumeRatio: 0 };
  const m = marketMetrics(market.klines);
  const totalWeight = Math.max(1, weights.volume + weights.rsi + weights.breakout + weights.book);
  const normalized = {
    volume: Math.round((weights.volume / totalWeight) * 100),
    rsi: Math.round((weights.rsi / totalWeight) * 100),
    breakout: Math.round((weights.breakout / totalWeight) * 100),
    book: 100 - Math.round((weights.volume / totalWeight) * 100) - Math.round((weights.rsi / totalWeight) * 100) - Math.round((weights.breakout / totalWeight) * 100),
  };

  const volumeMetric = clamp(((m.volumeRatio - 0.8) / 1.2) * 100);
  const r = rsi7(market.klines.map((k) => k.c));
  const rsiMetric = r < 28 || (r >= 55 && r <= 68) ? 100 : r < 40 || (r >= 50 && r < 55) ? 55 : r > 68 && r <= 75 ? 35 : 10;
  const nearBreakout = m.current >= m.peak15 * 0.985;
  const breakoutMetric = m.change5 >= 0.5 && m.change5 <= 5 && nearBreakout ? 100 : m.change5 > 0 ? 55 : m.change5 <= -5 && m.change5 >= -10 && m.change15 > 0 ? 65 : 10;
  const bidVolume = market.bids.slice(0, 10).reduce((sum, [price, quantity]) => sum + price * quantity, 0);
  const askVolume = market.asks.slice(0, 10).reduce((sum, [price, quantity]) => sum + price * quantity, 0);
  const pressure = bidVolume + askVolume > 0 ? bidVolume / (bidVolume + askVolume) : 0.5;
  const bookMetric = clamp(((pressure - 0.45) / 0.2) * 100);

  const weighted = (metric: number, max: number) => Math.round((metric / 100) * max);
  const reasons: Reason[] = [
    { ok: volumeMetric >= 70, pts: weighted(volumeMetric, normalized.volume), max: normalized.volume, text: `Aceleração de volume ${Math.round((m.volumeRatio - 1) * 100)}% vs. média anterior` },
    { ok: rsiMetric === 100, pts: weighted(rsiMetric, normalized.rsi), max: normalized.rsi, text: r < 28 ? `RSI(7) em sobrevenda (${r.toFixed(1)})` : `RSI(7) em ${r >= 55 && r <= 68 ? "rompimento saudável" : "zona neutra"} (${r.toFixed(1)})` },
    { ok: breakoutMetric === 100, pts: weighted(breakoutMetric, normalized.breakout), max: normalized.breakout, text: `Rompimento de preço: ${m.change5.toFixed(2)}% em 5m${nearBreakout ? " próximo ao topo" : ""}` },
    { ok: bookMetric >= 70, pts: weighted(bookMetric, normalized.book), max: normalized.book, text: `Fluxo do livro: ${Math.round(pressure * 100)}% de pressão compradora` },
  ];
  const antiTop = antiTopCheck(market.klines);
  const score = reasons.reduce((sum, reason) => sum + reason.pts, 0);
  return {
    score,
    reasons,
    safe: antiTop.ok,
    safeReason: !antiTop.ok ? antiTop.reason : undefined,
    change5: m.change5,
    change15: m.change15,
    volumeRatio: m.volumeRatio,
  };
}

export function jevLevels(entry: number, settings: Pick<JevSettings, "tp" | "sl">) {
  return { tp: entry * (1 + settings.tp / 100), sl: entry * (1 - settings.sl / 100) };
}

export type JevOpenPosition = { entry: number; tp: number; sl: number; peak: number; trailed: boolean };
export type JevExit = { action: "hold" | "tp" | "sl" | "trail"; peak: number; trailed: boolean; sl: number; reason?: string };

export function evaluateJevExit(position: JevOpenPosition, price: number, settings: Pick<JevSettings, "trailTrigger" | "trailDistance">): JevExit {
  const peak = Math.max(position.peak, price);
  const trailed = position.trailed || price >= position.entry * (1 + settings.trailTrigger / 100);
  const trailingStop = trailed ? peak * (1 - settings.trailDistance / 100) : position.sl;
  const effectiveStop = Math.max(position.sl, trailingStop);
  if (price >= position.tp) return { action: "tp", peak, trailed, sl: effectiveStop, reason: "Take Profit" };
  if (price <= effectiveStop) {
    return { action: "sl", peak, trailed, sl: effectiveStop, reason: trailed && trailingStop > position.sl ? "Trailing Stop" : "Stop Loss" };
  }
  if (trailed && !position.trailed) return { action: "trail", peak, trailed, sl: effectiveStop, reason: "Trailing ativado" };
  return { action: "hold", peak, trailed, sl: effectiveStop };
}

export const COOLDOWN_MS = 60_000;
export const cooldownRemaining = (cooldownUntil: number, now: number) => Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
export const roundTripPnl = (sizeUsdt: number, entry: number, exit: number) => {
  const fee = sizeUsdt * 0.001 + sizeUsdt * (exit / entry) * 0.001;
  return { fee, pnl: sizeUsdt * (exit / entry - 1) - fee };
};

export function jevDailyState(dayPnl: number, dayStart: number, settings: Pick<JevSettings, "dailyGoalPct" | "dailyStopPct">) {
  if (dayPnl <= -dayStart * (settings.dailyStopPct / 100) + 1e-9) return "stop" as const;
  if (dayPnl >= dayStart * (settings.dailyGoalPct / 100) - 1e-9) return "goal" as const;
  return "ok" as const;
}
