import { describe, expect, it } from "vitest";
import { CEX_RISK, DEX_RISK, dailyState, evaluateExit, levelsFor, netPnl, safetyCheck, type DexPair } from "@/lib/indicators";

const pair = (o: Partial<DexPair>): DexPair => ({ id: "x", chain: "solana", address: "a", symbol: "XYZ", name: "x", url: "", price: 1, ch5m: 1, ch1h: 1, liquidity: 100000, vol5m: 5000, vol1h: 30000, buys5m: 10, sells5m: 5, buys1h: 100, sells1h: 60, createdAt: 0, ...o });

describe("regras", () => {
  it("CEX TP +3.2% e SL -1.5%", () => {
    const l = levelsFor(100, CEX_RISK);
    expect(l.tp).toBeCloseTo(103.2); expect(l.sl).toBeCloseTo(98.5);
  });
  it("DEX TP +4.5% e SL -2.0%", () => {
    const l = levelsFor(100, DEX_RISK);
    expect(l.tp).toBeCloseTo(104.5); expect(l.sl).toBeCloseTo(98);
  });
  it("trailing CEX em +2% trava stop em +0.4%", () => {
    const d = evaluateExit({ entry: 100, tp: 103.2, sl: 98.5, trailed: false }, 102, CEX_RISK);
    expect(d.action).toBe("trail"); expect(d.sl).toBeCloseTo(100.4);
  });
  it("trailing DEX em +2.5% trava stop em +0.8%", () => {
    const d = evaluateExit({ entry: 100, tp: 104.5, sl: 98, trailed: false }, 102.5, DEX_RISK);
    expect(d.sl).toBeCloseTo(100.8);
  });
  it("taxa de 0.2% no P/L", () => {
    expect(netPnl(98, 100, 103.2).pnl).toBeCloseTo(98 * 0.032 - 0.196);
  });
  it("stop diário em -R$10 sobre R$100 e meta em +R$30", () => {
    expect(dailyState(-10, 100)).toBe("stop");
    expect(dailyState(-9.9, 100)).toBe("ok");
    expect(dailyState(30, 100)).toBe("goal");
  });
  it("filtro anti-rug", () => {
    expect(safetyCheck(pair({ liquidity: 49000 })).ok).toBe(false);
    expect(safetyCheck(pair({ vol1h: 19000 })).ok).toBe(false);
    expect(safetyCheck(pair({ sells1h: 0 })).ok).toBe(false);
    expect(safetyCheck(pair({})).ok).toBe(true);
  });
});
