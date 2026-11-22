import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { JevMarket } from "@/lib/jev";
import { MAX_SPREAD, spreadOf } from "@/lib/paper";

// Public, unsigned market events only. REST and all signed calls stay on the server.
export function useGateEvents(market: MutableRefObject<Record<string, JevMarket>>, enabled: boolean) {
  const [eventVersion, setEventVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const lastEvent = useRef(0);
  const symbols = Object.keys(market.current).sort().join(",");
  useEffect(() => {
    if (!enabled || !symbols) return;
    let active = true;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const volumes = new Map<string, { bucket: number; current: number; prior: number[] }>();
    const connect = () => {
      socket = new WebSocket("wss://api.gateio.ws/ws/v4/");
      socket.onopen = () => {
        if (!active || !socket) return;
        attempts = 0; setConnected(true);
        for (const channel of ["spot.book_ticker", "spot.trades"]) socket.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel, event: "subscribe", payload: symbols.split(",") }));
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data) as { channel?: string; event?: string; result?: { s?: string; b?: string; B?: string; a?: string; A?: string; t?: number; currency_pair?: string; amount?: string; price?: string } };
          if (message.event !== "update" || !message.result) return;
          const r = message.result;
          const symbol = r.s ?? r.currency_pair;
          const item = symbol ? market.current[symbol] : undefined;
          if (!item || !symbol) return;
          let urgent = false;
          if (message.channel === "spot.book_ticker") {
            const old = spreadOf(item);
            const bid = Number(r.b), ask = Number(r.a), bidQty = Number(r.B), askQty = Number(r.A);
            const timestamp = Number(r.t);
            if (!(bid > 0 && ask >= bid && bidQty > 0 && askQty > 0) || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 10_000) return;
            item.bids = [[bid, bidQty]]; item.asks = [[ask, askQty]]; item.bookTime = timestamp;
            const next = spreadOf(item);
            urgent = next !== null && old !== null && (old <= MAX_SPREAD) !== (next <= MAX_SPREAD);
          } else if (message.channel === "spot.trades") {
            const amount = Number(r.amount) * Number(r.price);
            if (!Number.isFinite(amount) || amount <= 0) return;
            const bucket = Math.floor(Date.now() / 10_000);
            const history = volumes.get(symbol) ?? { bucket, current: 0, prior: [] };
            if (bucket !== history.bucket) { history.prior = [...history.prior, history.current].slice(-6); history.current = 0; history.bucket = bucket; }
            history.current += amount; volumes.set(symbol, history);
            const avg = history.prior.reduce((sum, x) => sum + x, 0) / Math.max(1, history.prior.length);
            urgent = history.prior.length >= 3 && avg > 0 && history.current >= 2 * avg;
          }
          if (urgent && Date.now() - lastEvent.current >= 1000) { lastEvent.current = Date.now(); setEventVersion((v) => v + 1); }
        } catch { /* malformed public event: ignore */ }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => { if (!active) return; setConnected(false); retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts++)); };
    };
    connect();
    return () => { active = false; if (retry) clearTimeout(retry); socket?.close(); };
  }, [enabled, market, symbols]);
  return { eventVersion, connected };
}