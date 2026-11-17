import { useEffect, useRef, useState } from "react";
import type { DexPair } from "@/lib/indicators";

type Raw = {
  chainId: string; pairAddress: string; url: string; priceUsd?: string; pairCreatedAt?: number;
  baseToken: { symbol: string; name: string }; quoteToken: { symbol: string };
  priceChange?: { m5?: number; h1?: number }; liquidity?: { usd?: number }; volume?: { m5?: number; h1?: number };
  txns?: { m5?: { buys: number; sells: number }; h1?: { buys: number; sells: number } };
};
const toPair = (r: Raw): DexPair => ({
  id: `${r.chainId}:${r.pairAddress}`, chain: r.chainId, address: r.pairAddress, url: r.url,
  symbol: r.baseToken.symbol, name: r.baseToken.name, price: +(r.priceUsd ?? 0),
  ch5m: r.priceChange?.m5 ?? 0, ch1h: r.priceChange?.h1 ?? 0, liquidity: r.liquidity?.usd ?? 0,
  vol5m: r.volume?.m5 ?? 0, vol1h: r.volume?.h1 ?? 0, buys5m: r.txns?.m5?.buys ?? 0, sells5m: r.txns?.m5?.sells ?? 0,
  buys1h: r.txns?.h1?.buys ?? 0, sells1h: r.txns?.h1?.sells ?? 0, createdAt: r.pairCreatedAt ?? 0,
});
const API = "https://api.dexscreener.com/latest/dex";

export function useDexRadar(enabled: boolean, tracked: string | null) {
  const pairs = useRef<DexPair[]>([]);
  const history = useRef<Record<string, number[]>>({});
  const [version, setVersion] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(0);

  const push = (p: DexPair) => { const h = (history.current[p.id] ??= []); h.push(p.price); if (h.length > 120) h.shift(); };

  useEffect(() => {
    if (!enabled) return;
    const load = async () => {
      try {
        const qs = ["solana", "base", "pump", "meme"];
        const res = await Promise.all(qs.map((q) => fetch(`${API}/search?q=${q}`).then((r) => r.json()).catch(() => ({ pairs: [] }))));
        const map = new Map<string, DexPair>();
        res.flatMap((r: { pairs?: Raw[] }) => r.pairs ?? [])
          .filter((r) => (r.chainId === "solana" || r.chainId === "base") && ["SOL", "WETH", "USDC"].includes(r.quoteToken.symbol))
          .forEach((r) => { const p = toPair(r); if (p.price > 0) map.set(p.id, p); });
        pairs.current = [...map.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 24);
        pairs.current.forEach(push);
        setLastUpdate(Date.now()); setVersion((v) => v + 1);
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [enabled]);

  // Fast polling of the open DEX position
  useEffect(() => {
    if (!tracked) return;
    const [chain, addr] = tracked.split(":");
    const id = setInterval(async () => {
      try {
        const j = await (await fetch(`${API}/pairs/${chain}/${addr}`)).json();
        const raw = (j.pairs?.[0] ?? j.pair) as Raw | undefined;
        if (!raw) return;
        const p = toPair(raw);
        pairs.current = pairs.current.some((x) => x.id === p.id) ? pairs.current.map((x) => (x.id === p.id ? p : x)) : [p, ...pairs.current];
        push(p);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(id);
  }, [tracked]);

  return { pairs, history, version, lastUpdate };
}
