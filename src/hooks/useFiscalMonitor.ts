import { useEffect, useRef, useState } from "react";
import { appendFiscal, fiscalSummary, type FiscalFill } from "@/lib/fiscal";
const KEY = "ia-jev-fiscal-v1";
export function useFiscalMonitor(mode: "PAPER" | "REAL") {
  const fills = useRef<FiscalFill[]>([]);
  const rate = useRef<{ value: number; time: number } | null>(null);
  const [version, setVersion] = useState(0);
  const [quoteError, setQuoteError] = useState("");
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]"); if (Array.isArray(saved)) fills.current = saved.filter((f: FiscalFill) => typeof f.id === "string" && Number.isFinite(f.time) && Number.isFinite(f.usd) && f.usd > 0 && (f.brlRate === null || (Number.isFinite(f.brlRate) && Number(f.brlRate) > 0))); } catch { /* malformed local records ignored */ }
    setVersion((v) => v + 1);
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("https://economia.awesomeapi.com.br/last/USD-BRL", { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`Cotação indisponível (${response.status})`);
        const data = await response.json() as { USDBRL?: { bid?: string; timestamp?: string } };
        const value = Number(data.USDBRL?.bid), time = Number(data.USDBRL?.timestamp) * 1000;
        if (!(value > 0) || !Number.isFinite(value) || !Number.isFinite(time) || Date.now() - time > 86_400_000) throw new Error("Cotação inválida ou vencida");
        if (active) { rate.current = { value, time }; setQuoteError(""); setVersion((v) => v + 1); }
      } catch (e) { if (active) setQuoteError(e instanceof Error ? e.message : "Sem cotação"); }
    };
    void load(); const timer = setInterval(() => { void load(); setVersion((v) => v + 1); }, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const record = (fill: Omit<FiscalFill, "brlRate">) => {
    const quote = rate.current;
    fills.current = appendFiscal(fills.current, { ...fill, brlRate: quote && Date.now() - quote.time <= 86_400_000 ? quote.value : null });
    try { localStorage.setItem(KEY, JSON.stringify(fills.current)); } catch { setQuoteError("Não foi possível salvar o monitor neste navegador"); }
    setVersion((v) => v + 1);
  };
  return { ...fiscalSummary(fills.current, mode, Date.now()), mode, rate: rate.current?.value ?? null, quoteError, record, version, fills: fills.current };
}