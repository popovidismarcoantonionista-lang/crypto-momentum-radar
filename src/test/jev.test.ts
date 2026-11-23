import { describe, expect, it } from "vitest";
import { DEFAULT_JEV_SETTINGS, antiTopCheck, cooldownRemaining, evaluateJevExit, jevDailyState, jevLevels, roundTripPnl, scoreJev, type JevMarket } from "@/lib/jev";
import type { Kline } from "@/lib/indicators";

const candle = (close: number, volume = 100): Kline => ({ t: 0, o: close, h: close, l: close, c: close, v: volume });
const market = (klines: Kline[]): JevMarket => ({ symbol: "PEARL_USDT", price: klines.at(-1)?.c ?? 1, change24: 8, quoteVolume: 500_000, klines, bids: [[1, 800]], asks: [[1.001, 200]], bookTime: Date.now() });

describe("IA Jev — parâmetros e proteções", () => {
  it("usa certeza 85%, análise de 5s e risco +4%/-2%", () => {
    expect(DEFAULT_JEV_SETTINGS.trigger).toBe(85);
    expect(DEFAULT_JEV_SETTINGS.intervalSeconds).toBe(5);
    const levels = jevLevels(100, DEFAULT_JEV_SETTINGS);
    expect(levels.tp).toBeCloseTo(104);
    expect(levels.sl).toBeCloseTo(98);
  });

  it("ativa trailing em +1,8% e vende ao recuar 0,8% do pico", () => {
    const start = { entry: 100, tp: 104, sl: 98, peak: 100, trailed: false };
    const activated = evaluateJevExit(start, 101.8, DEFAULT_JEV_SETTINGS);
    expect(activated.action).toBe("trail");
    expect(activated.sl).toBeCloseTo(100.9856);
    const peaked = evaluateJevExit({ ...start, peak: 102.5, trailed: true }, 102.5, DEFAULT_JEV_SETTINGS);
    expect(peaked.sl).toBeCloseTo(101.68);
    expect(evaluateJevExit({ ...start, peak: 102.5, trailed: true }, 101.67, DEFAULT_JEV_SETTINGS).reason).toBe("Trailing Stop");
  });

  it("bloqueia alta acima de 15% sem pullback e libera recuo de 2% com volume", () => {
    const extended = [candle(100), ...Array.from({ length: 12 }, () => candle(116)), candle(118), candle(120)];
    expect(antiTopCheck(extended).ok).toBe(false);
    const pullback = [candle(100), ...Array.from({ length: 10 }, () => candle(118, 100)), candle(122, 100), candle(119.56, 180), candle(119.56, 200), candle(119.56, 220)];
    expect(antiTopCheck(pullback).ok).toBe(true);
  });

  it("normaliza os quatro pesos para uma nota máxima de 100", () => {
    const klines = Array.from({ length: 20 }, (_, index) => candle(100 + index * 0.1, index > 16 ? 250 : 100));
    const result = scoreJev(market(klines), { volume: 2, rsi: 1, breakout: 1, book: 1 });
    expect(result.reasons.reduce((sum, reason) => sum + reason.max, 0)).toBe(100);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("aplica cooldown de 60 segundos", () => {
    expect(cooldownRemaining(60_000, 0)).toBe(60);
    expect(cooldownRemaining(60_000, 59_100)).toBe(1);
    expect(cooldownRemaining(60_000, 61_000)).toBe(0);
  });

  it("desconta 0,2% de taxa e aplica stop/meta diários configuráveis", () => {
    expect(roundTripPnl(17, 100, 104).pnl).toBeCloseTo(0.646);
    expect(jevDailyState(-1.7, 17, DEFAULT_JEV_SETTINGS)).toBe("stop");
    expect(jevDailyState(5.1, 17, DEFAULT_JEV_SETTINGS)).toBe("goal");
  });
});
