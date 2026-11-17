export type Kline = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Level = [number, number];
export type Reason = { ok: boolean; text: string; pts: number; max: number };
export type ScoreResult = { score: number; reasons: Reason[] };

export type DexPair = {
  id: string; chain: string; address: string; symbol: string; name: string; url: string;
  price: number; ch5m: number; ch1h: number; liquidity: number; vol5m: number; vol1h: number;
  buys5m: number; sells5m: number; buys1h: number; sells1h: number; createdAt: number;
};

export const FEE_ROUNDTRIP = 0.002; // 0.2%
export const ALLOCATION = 0.98;
export const MIN_ORDER_USDT = 5;
export const DAILY_GOAL_PCT = 0.3;
export const DAILY_STOP_PCT = 0.1;

export type Risk = { tp: number; sl: number; trailTrigger: number; trailLock: number };
export const CEX_RISK: Risk = { tp: 3.2, sl: 1.5, trailTrigger: 2.0, trailLock: 0.4 };
export const DEX_RISK: Risk = { tp: 4.5, sl: 2.0, trailTrigger: 2.5, trailLock: 0.8 };

export const SAFETY = { minLiquidity: 50_000, minVol1h: 20_000, minSellRatio: 0.15 };

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

export function rsi(closes: number[], period = 7): number {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}

export function scoreCex(klines: Kline[], bids: Level[], asks: Level[]): ScoreResult {
  const reasons: Reason[] = [];
  // 1. Volume (35)
  const last3 = klines.slice(-3);
  const base = klines.slice(-33, -3);
  const avg3 = last3.reduce((s, k) => s + k.v, 0) / (last3.length || 1);
  const avg30 = base.reduce((s, k) => s + k.v, 0) / (base.length || 1);
  const ratio = avg30 > 0 ? avg3 / avg30 : 0;
  const vPts = Math.round(35 * clamp((ratio - 1) / 1.4));
  reasons.push({ ok: vPts >= 25, pts: vPts, max: 35, text: `Volume ${Math.round((ratio - 1) * 100)}% ${ratio >= 1 ? "acima" : "abaixo"} da média` });
  // 2. RSI7 (25)
  const r = rsi(klines.map((k) => k.c), 7);
  let rPts = 0;
  if (r < 28 || (r >= 55 && r <= 68)) rPts = 25;
  else if (r < 40) rPts = 12;
  else if (r > 68 && r <= 75) rPts = 8;
  else if (r >= 50 && r < 55) rPts = 10;
  reasons.push({ ok: rPts === 25, pts: rPts, max: 25, text: r < 28 ? `RSI(7) em sobrevenda (${r.toFixed(1)})` : r >= 55 && r <= 68 ? `RSI(7) em rompimento saudável (${r.toFixed(1)})` : `RSI(7) neutro/fora da zona (${r.toFixed(1)})` });
  // 3. Order book (25)
  const bv = bids.slice(0, 10).reduce((s, [p, q]) => s + p * q, 0);
  const av = asks.slice(0, 10).reduce((s, [p, q]) => s + p * q, 0);
  const pressure = bv + av > 0 ? bv / (bv + av) : 0.5;
  const oPts = Math.round(25 * clamp((pressure - 0.5) / 0.15));
  reasons.push({ ok: oPts >= 18, pts: oPts, max: 25, text: `Pressão compradora de ${Math.round(pressure * 100)}% no Order Book` });
  // 4. Spread (15)
  const bb = bids[0]?.[0] ?? 0, ba = asks[0]?.[0] ?? 0;
  const spread = bb > 0 ? ((ba - bb) / bb) * 100 : 1;
  const sPts = spread <= 0.05 ? 15 : spread <= 0.15 ? 8 : 0;
  reasons.push({ ok: sPts === 15, pts: sPts, max: 15, text: sPts === 15 ? `Spread mínimo (${spread.toFixed(3)}%)` : `Spread acima do ideal (${spread.toFixed(3)}%)` });
  return { score: vPts + rPts + oPts + sPts, reasons };
}

export function safetyCheck(p: DexPair): { ok: boolean; reason?: string } {
  if (p.liquidity < SAFETY.minLiquidity) return { ok: false, reason: `liquidez abaixo de $50k ($${Math.round(p.liquidity / 1000)}k)` };
  if (p.vol1h < SAFETY.minVol1h) return { ok: false, reason: `volume 1h abaixo de $20k ($${Math.round(p.vol1h / 1000)}k)` };
  const tx = p.buys1h + p.sells1h;
  if (p.sells1h === 0) return { ok: false, reason: "nenhuma venda executada (suspeita de honeypot)" };
  if (tx > 0 && p.sells1h / tx < SAFETY.minSellRatio) return { ok: false, reason: `compras/vendas desequilibradas (${p.buys1h}/${p.sells1h}) — risco de honeypot` };
  return { ok: true };
}

export function scoreDex(p: DexPair, tradeUsd: number): ScoreResult {
  const reasons: Reason[] = [];
  const prevAvg = (p.vol1h - p.vol5m) / 11;
  const accel = prevAvg > 0 ? p.vol5m / prevAvg : p.vol5m > 0 ? 4 : 0;
  const vPts = Math.round(35 * clamp((accel - 1) / 3));
  reasons.push({ ok: vPts >= 30, pts: vPts, max: 35, text: `Volume 5m ${Math.round((accel - 1) * 100)}% vs média anterior` });
  const hasBoth = p.buys5m > 0 && p.sells5m > 0;
  const lPts = hasBoth ? Math.round(25 * clamp(p.liquidity / 200_000)) : 0;
  reasons.push({ ok: lPts >= 18, pts: lPts, max: 25, text: hasBoth ? `Compras/vendas reais (${p.buys5m}/${p.sells5m}) e liquidez $${Math.round(p.liquidity / 1000)}k` : "Sem histórico de compra E venda nos últimos 5m" });
  const buyP = p.buys5m + p.sells5m > 0 ? p.buys5m / (p.buys5m + p.sells5m) : 0;
  const breakout = p.ch5m >= 0.5 && p.ch5m <= 6 && buyP >= 0.55;
  const rebound = p.ch1h <= -5 && p.ch1h >= -10 && p.ch5m > 0;
  const mPts = breakout || rebound ? 25 : p.ch5m > 0 ? 10 : 0;
  reasons.push({ ok: mPts === 25, pts: mPts, max: 25, text: breakout ? `Rompimento com força compradora (${p.ch5m.toFixed(1)}% 5m)` : rebound ? `Repique após queda de ${p.ch1h.toFixed(1)}%` : `Momentum fraco (${p.ch5m.toFixed(1)}% 5m)` });
  const slip = p.liquidity > 0 ? (tradeUsd / p.liquidity) * 100 * 2 : 5;
  const cost = slip + FEE_ROUNDTRIP * 100 + 0.6;
  const sPts = Math.abs(p.ch5m) >= cost * 2 ? 15 : Math.abs(p.ch5m) >= cost ? 7 : 0;
  reasons.push({ ok: sPts === 15, pts: sPts, max: 15, text: `Custo estimado ${cost.toFixed(2)}% vs oscilação ${Math.abs(p.ch5m).toFixed(2)}%` });
  return { score: vPts + lPts + mPts + sPts, reasons };
}

export type OpenPos = { entry: number; tp: number; sl: number; trailed: boolean };
export type ExitDecision = { action: "hold" | "tp" | "sl" | "trail"; sl: number };

export function levelsFor(entry: number, r: Risk) {
  return { tp: entry * (1 + r.tp / 100), sl: entry * (1 - r.sl / 100) };
}

export function evaluateExit(pos: OpenPos, price: number, r: Risk): ExitDecision {
  if (price >= pos.tp) return { action: "tp", sl: pos.sl };
  if (!pos.trailed && price >= pos.entry * (1 + r.trailTrigger / 100)) {
    return { action: "trail", sl: pos.entry * (1 + r.trailLock / 100) };
  }
  if (price <= pos.sl) return { action: "sl", sl: pos.sl };
  return { action: "hold", sl: pos.sl };
}

export function netPnl(sizeBrl: number, entry: number, exit: number) {
  const fee = sizeBrl * FEE_ROUNDTRIP;
  return { fee, pnl: sizeBrl * (exit / entry - 1) - fee };
}

export function dailyState(dayPnl: number, dayStart: number) {
  if (dayPnl <= -dayStart * DAILY_STOP_PCT) return "stop" as const;
  if (dayPnl >= dayStart * DAILY_GOAL_PCT) return "goal" as const;
  return "ok" as const;
}
