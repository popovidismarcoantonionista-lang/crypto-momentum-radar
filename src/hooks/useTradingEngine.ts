import { useCallback, useEffect, useRef, useState } from "react";
import { useBinanceMarket } from "./useBinanceMarket";
import { useDexRadar } from "./useDexRadar";
import { placeRealOrder } from "@/lib/binance.functions";
import {
  ALLOCATION, CEX_RISK, DEX_RISK, MIN_ORDER_USDT, dailyState, evaluateExit, levelsFor, netPnl,
  safetyCheck, scoreCex, scoreDex, type Kline, type Reason,
} from "@/lib/indicators";

export type Mode = "CEX" | "DEX";
export type Settings = { trigger: number; lock: string; mode: Mode; autoPause: boolean; real: boolean };
export type Position = {
  id: string; label: string; source: Mode; entry: number; tp: number; sl: number; trailed: boolean;
  sizeBrl: number; score: number; openedAt: number; realQty?: string;
};
export type Trade = { time: number; pair: string; source: Mode; entry: number; exit: number; score: number; fee: number; pnl: number; reason: string };
export type Candidate = { id: string; label: string; source: Mode; price: number; change: number; score: number; reasons: Reason[]; safe: boolean; safeReason?: string | undefined; extra?: string };
export type Log = { t: number; kind: "scan" | "filter" | "buy" | "sell" | "warn" | "info"; msg: string };
type Store = { balance: number; trades: Trade[]; day: string; dayStart: number; position: Position | null; halted: boolean; settings: Settings };

const KEY = "momentum-bot-v1";
const today = () => new Date().toLocaleDateString("sv");
const fresh = (): Store => ({ balance: 100, trades: [], day: today(), dayStart: 100, position: null, halted: false, settings: { trigger: 85, lock: "AUTO", mode: "CEX", autoPause: true, real: false } });

export function useTradingEngine() {
  const s = useRef<Store>(fresh());
  const [, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const busy = useRef(false);
  const lastDexVersion = useRef(-1);

  const { market, brl, connected } = useBinanceMarket();
  const pos = s.current.position;
  const dex = useDexRadar(s.current.settings.mode === "DEX", pos?.source === "DEX" ? pos.id : null);

  const log = useCallback((kind: Log["kind"], msg: string) => setLogs((l) => [...l.slice(-199), { t: Date.now(), kind, msg }]), []);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s.current)); } catch { /* */ } setTick((t) => t + 1); };

  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) s.current = { ...fresh(), ...JSON.parse(raw) }; } catch { /* */ }
    log("info", "Robô carregado em modo Paper Trading. Clique em Iniciar Robô.");
    setTick((t) => t + 1);
  }, [log]);

  const updateSettings = (p: Partial<Settings>) => { s.current.settings = { ...s.current.settings, ...p }; save(); };
  const setRun = (v: boolean) => { runningRef.current = v; setRunning(v); };

  const closePosition = useCallback(async (price: number, reason: string) => {
    const st = s.current; const p = st.position; if (!p) return;
    if (st.settings.real && p.source === "CEX" && p.realQty) {
      const r = await placeRealOrder({ data: { symbol: p.id, side: "SELL", quantity: p.realQty } });
      if (!r.ok) { log("warn", `[REAL] Falha na venda: ${r.error}`); return; }
    }
    const { fee, pnl } = netPnl(p.sizeBrl, p.entry, price);
    st.balance += pnl;
    st.trades = [{ time: Date.now(), pair: p.label, source: p.source, entry: p.entry, exit: price, score: p.score, fee, pnl, reason }, ...st.trades].slice(0, 200);
    st.position = null;
    log("sell", `[VENDA] ${p.label} @ ${fmtP(price)} | ${reason} | P/L líquido R$ ${pnl.toFixed(2)}`);
    const dayPnl = st.balance - st.dayStart;
    const d = dailyState(dayPnl, st.dayStart);
    if (d === "stop") { st.halted = true; setRun(false); log("warn", `[CIRCUIT BREAKER] Stop diário atingido (R$ ${dayPnl.toFixed(2)}). Entradas bloqueadas até amanhã.`); }
    if (d === "goal" && st.settings.autoPause) { setRun(false); log("info", `[META] Meta diária atingida (+R$ ${dayPnl.toFixed(2)}). Robô pausado.`); }
    save();
  }, [log]);

  useEffect(() => {
    const id = setInterval(async () => {
      const st = s.current;
      if (st.day !== today()) { st.day = today(); st.dayStart = st.balance; st.halted = false; log("info", "Novo dia: stop diário e meta reiniciados."); }
      const usdBrl = brl.current;
      const tradeUsd = (st.balance * ALLOCATION) / usdBrl;
      const list: Candidate[] = [];
      for (const [sym, m] of Object.entries(market.current)) {
        if (m.klines.length < 10 || !m.bids.length) continue;
        const r = scoreCex(m.klines, m.bids, m.asks);
        list.push({ id: sym, label: sym, source: "CEX", price: m.price, change: m.change24, score: r.score, reasons: r.reasons, safe: true });
      }
      if (st.settings.mode === "DEX") {
        const newRadar = dex.version !== lastDexVersion.current; lastDexVersion.current = dex.version;
        for (const p of dex.pairs.current) {
          const sc = safetyCheck(p);
          const r = scoreDex(p, tradeUsd);
          if (!sc.ok && newRadar) log("filter", `[FILTRO] Token ${p.symbol} (${p.chain}) ignorado: ${sc.reason}`);
          list.push({ id: p.id, label: `${p.symbol}/${p.chain === "solana" ? "SOL" : "BASE"}`, source: "DEX", price: p.price, change: p.ch5m, score: sc.ok ? r.score : Math.min(r.score, 40), reasons: r.reasons, safe: sc.ok, safeReason: sc.reason, extra: `Liq $${Math.round(p.liquidity / 1000)}k · Vol1h $${Math.round(p.vol1h / 1000)}k` });
        }
      }
      list.sort((a, b) => b.score - a.score);
      setCandidates(list);

      const p = st.position;
      if (p) {
        const c = list.find((x) => x.id === p.id);
        const price = c?.price ?? 0;
        if (price > 0 && !busy.current) {
          const risk = p.source === "DEX" ? DEX_RISK : CEX_RISK;
          const d = evaluateExit(p, price, risk);
          if (d.action === "trail") { p.sl = d.sl; p.trailed = true; log("info", `[TRAILING] ${p.label} bateu +${risk.trailTrigger}% → stop movido para +${risk.trailLock}% (${fmtP(d.sl)})`); save(); }
          else if (d.action === "tp" || d.action === "sl") { busy.current = true; await closePosition(price, d.action === "tp" ? "Take Profit" : p.trailed ? "Trailing Stop" : "Stop Loss"); busy.current = false; }
        }
        setTick((t) => t + 1);
        return;
      }
      if (!runningRef.current || st.halted || busy.current) return;
      const pool = list.filter((c) => (st.settings.mode === "CEX" ? c.source === "CEX" : true) && (st.settings.lock === "AUTO" || c.id === st.settings.lock));
      const best = pool[0];
      if (!best) { log("scan", "[SCAN] Aguardando dados de mercado..."); return; }
      if (best.score < st.settings.trigger || !best.safe) {
        log("scan", `[SCAN] ${pool.length} pares | melhor ${best.label} ${best.score}% — aguardando ≥ ${st.settings.trigger}%${best.reasons.filter((r) => !r.ok).slice(0, 1).map((r) => ` (✗ ${r.text})`).join("")}`);
        return;
      }
      const sizeBrl = st.balance * ALLOCATION;
      if (sizeBrl / usdBrl < MIN_ORDER_USDT) { log("warn", "[RISCO] Saldo abaixo da ordem mínima (5 USDT)."); return; }
      let realQty: string | undefined;
      if (st.settings.real && best.source === "CEX") {
        busy.current = true;
        const r = await placeRealOrder({ data: { symbol: best.id, side: "BUY", quoteOrderQty: sizeBrl / usdBrl } });
        busy.current = false;
        if (!r.ok) { log("warn", `[REAL] Ordem recusada: ${r.error}`); return; }
        realQty = r.executedQty;
      }
      const risk = best.source === "DEX" ? DEX_RISK : CEX_RISK;
      const lv = levelsFor(best.price, risk);
      st.position = { id: best.id, label: best.label, source: best.source, entry: best.price, ...lv, trailed: false, sizeBrl, score: best.score, openedAt: Date.now(), realQty };
      log("buy", `[COMPRA] ${best.label} @ ${fmtP(best.price)} | Score ${best.score}% | R$ ${sizeBrl.toFixed(2)} | TP ${fmtP(lv.tp)} SL ${fmtP(lv.sl)} — ${best.reasons.filter((r) => r.ok).map((r) => r.text).join("; ")}`);
      save();
    }, 1000);
    return () => clearInterval(id);
  }, [brl, market, dex.pairs, dex.version, log, closePosition]);

  const st = s.current;
  const selectedId = st.position?.id ?? (st.settings.lock !== "AUTO" ? st.settings.lock : candidates.find((c) => st.settings.mode === "DEX" || c.source === "CEX")?.id);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  let klines: Kline[] = [];
  if (selected?.source === "CEX") klines = market.current[selected.id]?.klines.slice(-60) ?? [];
  else if (selected) klines = (dex.history.current[selected.id] ?? []).map((c, i, a) => ({ t: i, o: a[i - 1] ?? c, c, h: Math.max(c, a[i - 1] ?? c), l: Math.min(c, a[i - 1] ?? c), v: 0 }));

  const best = candidates[0];
  const status = st.halted ? "STOP DIÁRIO ATINGIDO" : st.position ? "POSICIONADO" : !running ? "ROBÔ PARADO" : best && best.score >= st.settings.trigger - 20 ? `AGUARDANDO CONFIANÇA >= ${st.settings.trigger}%` : "ESCANEANDO MERCADO";

  return {
    ...st, running, logs, candidates, selected, klines, status, connected, usdBrl: brl.current,
    dexLastUpdate: dex.lastUpdate, dayPnl: st.balance - st.dayStart,
    start: () => { if (st.halted) { log("warn", "Stop diário ativo — bloqueado até amanhã."); return; } setRun(true); log("info", `Robô INICIADO (${st.settings.real ? "MODO REAL" : "Paper Trading"}, ${st.settings.mode}).`); },
    stop: () => { setRun(false); log("info", "Robô PARADO."); },
    closeNow: () => { const c = candidates.find((x) => x.id === st.position?.id); if (c) closePosition(c.price, "Saída manual"); },
    reset: () => { s.current = fresh(); setRun(false); save(); log("info", "Banca simulada reiniciada em R$ 100,00."); },
    updateSettings,
  };
}

export const fmtP = (p: number) => (p >= 1 ? p.toFixed(4) : p >= 0.01 ? p.toFixed(6) : p.toPrecision(4));
