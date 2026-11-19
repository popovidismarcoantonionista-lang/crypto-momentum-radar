import { useEffect, useRef, useState } from "react";
import { getGateMarket } from "@/lib/gateio.functions";
import type { JevMarket } from "@/lib/jev";

export function useGateMarket(intervalSeconds: number) {
  const market = useRef<Record<string, JevMarket>>({});
  const usdBrl = useRef(5.88);
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await getGateMarket();
        if (!active) return;
        const next: Record<string, JevMarket> = {};
        for (const item of result.markets) {
          const previous = market.current[item.symbol];
          next[item.symbol] = item.klines.length ? item : { ...item, klines: previous?.klines ?? [], bids: previous?.bids ?? [], asks: previous?.asks ?? [] };
        }
        market.current = next;
        usdBrl.current = result.usdBrl;
        setConnected(true);
        setError(result.failed ? `${result.failed} pares sem candles neste ciclo` : "");
        setLastUpdate(result.fetchedAt);
        setVersion((value) => value + 1);
      } catch (cause) {
        if (!active) return;
        setConnected(false);
        setError(cause instanceof Error ? cause.message : "Falha ao atualizar a Gate.io");
      } finally {
        inFlight.current = false;
      }
    };
    void load();
    const id = setInterval(load, Math.max(3, intervalSeconds) * 1000);
    return () => { active = false; clearInterval(id); };
  }, [intervalSeconds]);

  return { market, usdBrl, version, connected, lastUpdate, error };
}
