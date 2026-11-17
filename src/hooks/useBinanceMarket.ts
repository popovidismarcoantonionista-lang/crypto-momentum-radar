import { useEffect, useRef, useState } from "react";
import type { Kline, Level } from "@/lib/indicators";

export const CORE_MEMES = ["PEPEUSDT", "WIFUSDT", "BONKUSDT", "FLOKIUSDT", "PNUTUSDT", "NEIROUSDT", "SUIUSDT", "DOGEUSDT"];
export type SymState = { klines: Kline[]; bids: Level[]; asks: Level[]; price: number; change24: number };
const REST = "https://api.binance.com/api/v3";

export function useBinanceMarket() {
  const market = useRef<Record<string, SymState>>({});
  const brl = useRef(5.3);
  const [symbols, setSymbols] = useState<string[]>(CORE_MEMES);
  const [connected, setConnected] = useState(false);

  // Dynamic scanner: top USDT gainers with volume
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${REST}/ticker/24hr`);
        const all = (await r.json()) as { symbol: string; priceChangePercent: string; quoteVolume: string }[];
        const avail = new Set(all.map((t) => t.symbol));
        const top = all
          .filter((t) => t.symbol.endsWith("USDT") && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && !/^(USDC|FDUSD|TUSD|BUSD|DAI|EUR)/.test(t.symbol) && +t.quoteVolume > 5_000_000)
          .sort((a, b) => +b.priceChangePercent - +a.priceChangePercent)
          .slice(0, 4).map((t) => t.symbol);
        setSymbols([...new Set([...CORE_MEMES.filter((s) => avail.has(s)), ...top])]);
        const b = all.find((t) => t.symbol === "USDTBRL") as unknown as { lastPrice?: string } | undefined;
        if (b?.lastPrice) brl.current = +b.lastPrice;
      } catch { /* keep defaults */ }
    };
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    symbols.forEach(async (s) => {
      if (market.current[s]?.klines.length) return;
      try {
        const r = await fetch(`${REST}/klines?symbol=${s}&interval=1m&limit=60`);
        const rows = (await r.json()) as (string | number)[][];
        const klines = rows.map((k) => ({ t: +k[0]!, o: +k[1]!, h: +k[2]!, l: +k[3]!, c: +k[4]!, v: +k[5]! }));
        market.current[s] = { ...(market.current[s] ?? { bids: [], asks: [], change24: 0 }), klines, price: klines.at(-1)?.c ?? 0 };
      } catch { /* ignore */ }
    });
    const streams = symbols.flatMap((s) => { const l = s.toLowerCase(); return [`${l}@kline_1m`, `${l}@depth10@1000ms`, `${l}@miniTicker`]; });
    streams.push("usdtbrl@miniTicker");
    const connect = () => {
      ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => { setConnected(false); if (!closed) setTimeout(connect, 3000); };
      ws.onmessage = (ev) => {
        const { stream, data } = JSON.parse(ev.data);
        const sym = String(stream).split("@")[0].toUpperCase();
        if (sym === "USDTBRL") { brl.current = +data.c; return; }
        const st: SymState = (market.current[sym] ??= { klines: [], bids: [], asks: [], price: 0, change24: 0 });
        if (stream.includes("@kline")) {
          const k = data.k; const kl = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v };
          const last = st.klines.at(-1);
          if (last && last.t === kl.t) st.klines[st.klines.length - 1] = kl as Kline; else { st.klines.push(kl); if (st.klines.length > 120) st.klines.shift(); }
          st.price = kl.c;
        } else if (stream.includes("@depth")) {
          st.bids = data.bids.map((x: string[]) => [+x[0]!, +x[1]!]);
          st.asks = data.asks.map((x: string[]) => [+x[0]!, +x[1]!]);
        } else {
          st.change24 = ((+data.c - +data.o) / +data.o) * 100;
        }
      };
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, [symbols]);

  return { market, brl, symbols, connected };
}
