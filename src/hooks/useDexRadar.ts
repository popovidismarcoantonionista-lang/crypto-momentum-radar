import { useEffect, useRef, useState } from "react";
import type { DexPair } from "@/lib/indicators";
import type { DexSample, TokenIdentity } from "@/lib/leadlag";
import { onchainSafety, type RugReport } from "@/lib/growth";

type Pool = {
  id: string;
  attributes: {
    address: string;
    name: string;
    base_token_price_usd: string;
    reserve_in_usd: string;
    pool_created_at: string;
    price_change_percentage: { m5?: string; h1?: string };
    volume_usd: { m5?: string; h1?: string };
    transactions: { m5?: { buys: number; sells: number }; h1?: { buys: number; sells: number } };
  };
  relationships: { base_token: { data: { id: string } } };
};
type Token = { id: string; attributes: { address: string; name: string; symbol: string } };
const API = "https://api.geckoterminal.com/api/v2/networks/solana";
async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`API pública indisponível (${response.status})`);
  return response.json() as Promise<T>;
}
export function useDexRadar(enabled: boolean, tracked: string | null, minLiquidity = 10_000) {
  const pairs = useRef<DexPair[]>([]);
  const history = useRef<Record<string, number[]>>({});
  const samples = useRef<Record<string, DexSample[]>>({});
  const identities = useRef<Record<string, TokenIdentity>>({});
  const reports = useRef<Record<string, { time: number; report: RugReport }>>({});
  const safety = useRef<Record<string, { ok: boolean; reason: string }>>({});
  const [version, setVersion] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true,
      loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const results = await Promise.all(
          ["trending_pools", "new_pools"].map((path) =>
            getJson<{ data: Pool[]; included?: Token[] }>(
              `${API}/${path}?include=base_token,quote_token&page=1`,
            ),
          ),
        );
        const tokens = new Map(results.flatMap((r) => r.included ?? []).map((t) => [t.id, t]));
        const pools = new Map(results.flatMap((r) => r.data).map((p) => [p.id, p]));
        const now = Date.now();
        const next: DexPair[] = [];
        for (const pool of pools.values()) {
          const a = pool.attributes,
            token = tokens.get(pool.relationships.base_token.data.id);
          const price = Number(a.base_token_price_usd);
          if (!token || !Number.isFinite(price) || price <= 0) continue;
          const id = `solana:${a.address}`;
          identities.current[id] = { chain: "solana", address: token.attributes.address };
          next.push({
            id,
            address: a.address,
            chain: "solana",
            symbol: token.attributes.symbol,
            name: token.attributes.name,
            url: `https://www.geckoterminal.com/solana/pools/${a.address}`,
            price,
            liquidity: Number(a.reserve_in_usd),
            vol5m: Number(a.volume_usd.m5 ?? 0),
            vol1h: Number(a.volume_usd.h1 ?? 0),
            ch5m: Number(a.price_change_percentage.m5 ?? 0),
            ch1h: Number(a.price_change_percentage.h1 ?? 0),
            buys5m: a.transactions.m5?.buys ?? 0,
            sells5m: a.transactions.m5?.sells ?? 0,
            buys1h: a.transactions.h1?.buys ?? 0,
            sells1h: a.transactions.h1?.sells ?? 0,
            createdAt: Date.parse(a.pool_created_at),
          });
        }
        // Bound concurrent security requests; unknown security never releases an entry.
        const eligible = next
          .filter((p) => p.liquidity >= minLiquidity && p.vol5m > 1000)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 8);
        await Promise.all(
          eligible.map(async (p) => {
            const mint = identities.current[p.id]?.address;
            if (!mint) return;
            const cached = reports.current[mint];
            if (cached && now - cached.time < 120_000) return;
            try {
              const summary = await getJson<RugReport>(
                `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`,
              );
              const full = summary.token
                ? summary
                : await getJson<RugReport>(
                    `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`,
                  );
              reports.current[mint] = {
                time: Date.now(),
                report: { ...full, risks: summary.risks ?? full.risks ?? [] },
              };
            } catch {
              delete reports.current[mint];
            }
          }),
        );
        if (!active) return;
        for (const p of next) {
          const mint = identities.current[p.id]?.address;
          const cached = mint ? reports.current[mint] : undefined;
          safety.current[p.id] = onchainSafety(
            p.liquidity,
            p.vol5m,
            minLiquidity,
            cached && Date.now() - cached.time <= 120_000 ? cached.report : undefined,
          );
          const h = (history.current[p.id] ??= []);
          h.push(p.price);
          if (h.length > 120) h.shift();
          const s = (samples.current[p.id] ??= []);
          s.push({ time: Date.now(), price: p.price, volume5m: p.vol5m });
          if (s.length > 120) s.shift();
        }
        pairs.current = next.sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
        setLastUpdate(Date.now());
        setError("");
        setVersion((v) => v + 1);
      } catch (cause) {
        if (active) {
          pairs.current = [];
          safety.current = {};
          setError(cause instanceof Error ? cause.message : "GeckoTerminal indisponível");
          setVersion((v) => v + 1);
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, minLiquidity, tracked]);
  return { pairs, history, samples, identities, safety, version, lastUpdate, error };
}
