import { useCallback, useEffect, useRef, useState } from "react";
import { useGateMarket } from "./useGateMarket";
import { useDexRadar } from "./useDexRadar";
import { getGateOrder, getGateTicker, placeGateOrder } from "@/lib/gateio.functions";
import type { GateCredentials, GateOrder } from "@/lib/gateio";
import { safetyCheck, scoreDex, type Kline, type Reason } from "@/lib/indicators";
import {
  COOLDOWN_MS,
  DEFAULT_JEV_SETTINGS,
  cooldownRemaining,
  evaluateJevExit,
  jevDailyState,
  jevLevels,
  roundTripPnl,
  scoreJev,
  type JevSettings,
} from "@/lib/jev";

export type Settings = JevSettings & { real: boolean; lock: string };
export type Position = {
  id: string;
  label: string;
  source: "GATE";
  entry: number;
  tp: number;
  sl: number;
  peak: number;
  trailed: boolean;
  sizeUsdt: number;
  score: number;
  openedAt: number;
  realQty?: string | undefined;
  orderId?: string | undefined;
};
export type Trade = { time: number; pair: string; entry: number; exit: number; score: number; fee: number; pnl: number; reason: string; real: boolean };
export type Candidate = { id: string; label: string; source: "GATE" | "DEX"; price: number; change: number; score: number; reasons: Reason[]; safe: boolean; safeReason?: string | undefined; extra?: string; quoteVolume?: number };
export type Log = { t: number; kind: "scan" | "filter" | "buy" | "sell" | "warn" | "info"; msg: string };
type Store = {
  paperBalance: number;
  trades: Trade[];
  day: string;
  dayStart: number;
  dayPnl: number;
  position: Position | null;
  halted: boolean;
  cooldownUntil: number;
  settings: Settings;
};

const KEY = "ia-jev-trading-v2";
const today = () => new Date().toLocaleDateString("sv");
const fresh = (): Store => ({
  paperBalance: 17,
  trades: [],
  day: today(),
  dayStart: 17,
  dayPnl: 0,
  position: null,
  halted: false,
  cooldownUntil: 0,
  settings: { ...DEFAULT_JEV_SETTINGS, weights: { ...DEFAULT_JEV_SETTINGS.weights }, real: false, lock: "AUTO" },
});

export function useTradingEngine(credentials: GateCredentials | null) {
  const store = useRef<Store>(fresh());
  const [, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [order, setOrder] = useState<GateOrder | null>(null);
  const [realBalance, setRealBalance] = useState(0);
  const busy = useRef(false);
  const priceBusy = useRef(false);
  const lastMarketVersion = useRef(-1);
  const lastDexVersion = useRef(-1);
  const credentialsRef = useRef(credentials);
  const realBalanceRef = useRef(0);
  credentialsRef.current = credentials;
  realBalanceRef.current = realBalance;

  const gate = useGateMarket(store.current.settings.intervalSeconds);
  const dex = useDexRadar(true, null);

  const log = useCallback((kind: Log["kind"], msg: string) => setLogs((current) => [...current.slice(-199), { t: Date.now(), kind, msg }]), []);
  const save = useCallback(() => {
    try { localStorage.setItem(KEY, JSON.stringify(store.current)); } catch { /* armazenamento indisponível */ }
    setTick((value) => value + 1);
  }, []);
  const setRun = useCallback((value: boolean) => { runningRef.current = value; setRunning(value); }, []);
  const updateRealBalance = useCallback((value: number) => { realBalanceRef.current = value; setRealBalance(value); }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Store>;
        const defaults = fresh();
        store.current = {
          ...defaults,
          ...parsed,
          settings: {
            ...defaults.settings,
            ...parsed.settings,
            weights: { ...defaults.settings.weights, ...parsed.settings?.weights },
          },
        };
      }
    } catch { /* mantém configurações padrão */ }
    log("info", "IA Jev carregada. Configure a Gate.io ou inicie em Modo Simulação.");
    setTick((value) => value + 1);
  }, [log]);

  const closePosition = useCallback(async (price: number, reason: string) => {
    const state = store.current;
    const position = state.position;
    if (!position) return;
    if (state.settings.real) {
      const keys = credentialsRef.current;
      if (!keys || !position.realQty) {
        log("warn", "[REAL] Venda não enviada: reconecte suas chaves da Gate.io. A posição permanece aberta.");
        return;
      }
      const result = await placeGateOrder({ data: { credentials: keys, symbol: position.id, side: "sell", amount: Number(position.realQty) } });
      if (!result.ok) {
        setOrder({ orderId: position.orderId ?? "—", symbol: position.id, side: "sell", status: "ERRO", averagePrice: 0, executedQty: 0, filledTotal: 0, fee: 0, feeCurrency: "USDT", error: result.error, updatedAt: Date.now() });
        log("warn", `[REAL] Venda recusada pela Gate.io: ${result.error}`);
        return;
      }
      setOrder(result.order);
      updateRealBalance(realBalanceRef.current + position.sizeUsdt + roundTripPnl(position.sizeUsdt, position.entry, price).pnl);
      log("sell", `[REAL] Venda ${result.order.orderId} enviada | status ${result.order.status} | taxa ${result.order.fee} ${result.order.feeCurrency}`);
    }
    const { fee, pnl } = roundTripPnl(position.sizeUsdt, position.entry, price);
    if (!state.settings.real) state.paperBalance = Math.max(0, state.paperBalance + pnl);
    state.dayPnl += pnl;
    state.trades = [{ time: Date.now(), pair: position.label, entry: position.entry, exit: price, score: position.score, fee, pnl, reason, real: state.settings.real }, ...state.trades].slice(0, 200);
    state.position = null;
    state.cooldownUntil = Date.now() + COOLDOWN_MS;
    log("sell", `[VENDA] ${position.label} @ ${fmtP(price)} | ${reason} | P/L líquido ${pnl.toFixed(4)} USDT | cooldown 60s`);
    const daily = jevDailyState(state.dayPnl, state.dayStart, state.settings);
    if (daily === "stop") {
      state.halted = true;
      setRun(false);
      log("warn", `[CIRCUIT BREAKER] Perda diária de ${state.dayPnl.toFixed(2)} USDT. Entradas bloqueadas até amanhã.`);
    } else if (daily === "goal" && state.settings.autoPause) {
      setRun(false);
      log("info", `[META] Meta diária atingida (+${state.dayPnl.toFixed(2)} USDT). Robô pausado.`);
    }
    save();
  }, [log, save, setRun, updateRealBalance]);

  useEffect(() => {
    const id = setInterval(async () => {
      const state = store.current;
      const now = Date.now();
      const currentBalance = state.settings.real ? realBalanceRef.current : state.paperBalance;
      if (state.day !== today()) {
        state.day = today();
        state.dayStart = currentBalance;
        state.dayPnl = 0;
        state.halted = false;
        log("info", "Novo dia: meta e circuit breaker reiniciados.");
        save();
      }

      const open = state.position;
      if (open && !priceBusy.current) {
        priceBusy.current = true;
        try {
          const ticker = await getGateTicker({ data: open.id });
          const current = gate.market.current[open.id];
          if (current) current.price = ticker.price;
          else gate.market.current[open.id] = { symbol: open.id, price: ticker.price, change24: ticker.change24, quoteVolume: ticker.quoteVolume, klines: [], bids: [], asks: [] };
        } catch { /* mantém o último preço válido */ } finally { priceBusy.current = false; }
      }

      const list: Candidate[] = [];
      for (const [symbol, item] of Object.entries(gate.market.current)) {
        const analysis = scoreJev(item, state.settings.weights);
        list.push({ id: symbol, label: symbol, source: "GATE", price: item.price, change: item.change24, score: analysis.score, reasons: analysis.reasons, safe: analysis.safe, safeReason: analysis.safeReason, quoteVolume: item.quoteVolume, extra: `${analysis.change5 >= 0 ? "+" : ""}${analysis.change5.toFixed(2)}% 5m · Vol $${Math.round(item.quoteVolume / 1000)}k` });
      }
      const newRadar = dex.version !== lastDexVersion.current;
      lastDexVersion.current = dex.version;
      for (const pair of dex.pairs.current) {
        const safety = safetyCheck(pair);
        const analysis = scoreDex(pair, Math.max(1, currentBalance));
        if (!safety.ok && newRadar) log("filter", `[FILTRO] Token ${pair.symbol} (${pair.chain}) ignorado: ${safety.reason}`);
        list.push({ id: pair.id, label: `${pair.symbol}/${pair.chain === "solana" ? "SOL" : "BASE"}`, source: "DEX", price: pair.price, change: pair.ch5m, score: safety.ok ? analysis.score : Math.min(analysis.score, 40), reasons: analysis.reasons, safe: safety.ok, safeReason: safety.reason, extra: `Liq $${Math.round(pair.liquidity / 1000)}k · Vol1h $${Math.round(pair.vol1h / 1000)}k` });
      }
      list.sort((a, b) => a.id === "PEARL_USDT" ? -1 : b.id === "PEARL_USDT" ? 1 : b.score - a.score);
      setCandidates(list);

      const position = state.position;
      if (position) {
        const price = gate.market.current[position.id]?.price ?? 0;
        if (price > 0 && !busy.current) {
          const decision = evaluateJevExit(position, price, state.settings);
          position.peak = decision.peak;
          if (decision.action === "trail") {
            position.sl = decision.sl;
            position.trailed = true;
            log("info", `[TRAILING] Ativado em +${state.settings.trailTrigger}% | stop dinâmico ${fmtP(decision.sl)} (${state.settings.trailDistance}% abaixo do pico)`);
            save();
          } else if (decision.action === "tp" || decision.action === "sl") {
            busy.current = true;
            await closePosition(price, decision.reason ?? (decision.action === "tp" ? "Take Profit" : "Stop Loss"));
            busy.current = false;
          }
        }
        setTick((value) => value + 1);
        return;
      }

      if (!runningRef.current || state.halted || busy.current || now < state.cooldownUntil) return;
      const isNewScan = gate.version !== lastMarketVersion.current;
      lastMarketVersion.current = gate.version;
      const pool = list.filter((candidate) => candidate.source === "GATE" && (state.settings.lock === "AUTO" || candidate.id === state.settings.lock)).sort((a, b) => b.score - a.score);
      const best = pool[0];
      if (!best) { if (isNewScan) log("scan", "[SCAN] Aguardando dados da Gate.io..."); return; }
      if (!isNewScan) return;
      if (best.score < state.settings.trigger || !best.safe) {
        const failedReason = best.reasons.find((reason) => !reason.ok)?.text;
        log("scan", `[SCAN] ${pool.length} pares | melhor ${best.label} ${best.score}% | limiar ${state.settings.trigger}%${!best.safe ? ` | ${best.safeReason}` : failedReason ? ` | ✗ ${failedReason}` : ""}`);
        return;
      }

      const sizeUsdt = currentBalance * state.settings.allocation;
      if (sizeUsdt <= 0) { log("warn", "[RISCO] Saldo USDT indisponível. Teste a conexão para atualizar o saldo real."); return; }
      busy.current = true;
      let realQty: string | undefined;
      let orderId: string | undefined;
      let entry = best.price;
      if (state.settings.real) {
        const keys = credentialsRef.current;
        if (!keys) { busy.current = false; log("warn", "[REAL] Conecte suas chaves antes de liberar ordens reais."); return; }
        log("info", `[ORDEM] Enviando compra real de ${sizeUsdt.toFixed(2)} USDT em ${best.id}...`);
        const result = await placeGateOrder({ data: { credentials: keys, symbol: best.id, side: "buy", amount: sizeUsdt } });
        if (!result.ok) {
          setOrder({ orderId: "—", symbol: best.id, side: "buy", status: "ERRO", averagePrice: 0, executedQty: 0, filledTotal: 0, fee: 0, feeCurrency: "USDT", error: result.error, updatedAt: Date.now() });
          log("warn", `[REAL] Compra recusada pela Gate.io: ${result.error}`);
          busy.current = false;
          return;
        }
        setOrder(result.order);
        orderId = result.order.orderId;
        entry = result.order.averagePrice > 0 ? result.order.averagePrice : best.price;
        const baseCurrency = best.id.split("_")[0];
        const feeInBase = result.order.feeCurrency === baseCurrency ? result.order.fee : 0;
        const executed = result.order.executedQty > 0 ? result.order.executedQty - feeInBase : (sizeUsdt / entry) * 0.998;
        realQty = Math.max(0, executed * 0.999).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
        updateRealBalance(Math.max(0, realBalanceRef.current - sizeUsdt));
        log("buy", `[REAL] Compra ${orderId} | status ${result.order.status} | média ${fmtP(entry)} | taxa ${result.order.fee} ${result.order.feeCurrency}`);
      }
      const levels = jevLevels(entry, state.settings);
      state.position = { id: best.id, label: best.label, source: "GATE", entry, ...levels, peak: entry, trailed: false, sizeUsdt, score: best.score, openedAt: Date.now(), realQty, orderId };
      log("buy", `[COMPRA${state.settings.real ? " REAL" : " SIMULADA"}] ${best.label} @ ${fmtP(entry)} | IA Jev ${best.score}% | ${sizeUsdt.toFixed(2)} USDT | TP ${fmtP(levels.tp)} SL ${fmtP(levels.sl)}`);
      busy.current = false;
      save();
    }, 1000);
    return () => clearInterval(id);
  }, [closePosition, dex.pairs, dex.version, gate.market, gate.version, log, save]);

  useEffect(() => {
    if (!order || order.status !== "OPEN" || !credentials) return;
    const id = setInterval(async () => {
      const result = await getGateOrder({ data: { credentials, symbol: order.symbol, orderId: order.orderId } });
      if (result.ok) {
        setOrder(result.order);
        const position = store.current.position;
        if (position?.orderId === result.order.orderId && result.order.averagePrice > 0) {
          position.entry = result.order.averagePrice;
          const levels = jevLevels(position.entry, store.current.settings);
          position.tp = levels.tp;
          position.sl = Math.max(position.sl, levels.sl);
          save();
        }
      }
    }, 3000);
    return () => clearInterval(id);
  }, [credentials, order, save]);

  const state = store.current;
  const selectedId = state.position?.id ?? (state.settings.lock !== "AUTO" ? state.settings.lock : candidates.find((candidate) => candidate.id === "PEARL_USDT")?.id ?? candidates.find((candidate) => candidate.source === "GATE")?.id);
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;
  let klines: Kline[] = [];
  if (selected?.source === "GATE") klines = gate.market.current[selected.id]?.klines.slice(-60) ?? [];
  else if (selected) klines = (dex.history.current[selected.id] ?? []).map((close, index, all) => ({ t: index, o: all[index - 1] ?? close, c: close, h: Math.max(close, all[index - 1] ?? close), l: Math.min(close, all[index - 1] ?? close), v: 0 }));

  const cooldown = cooldownRemaining(state.cooldownUntil, Date.now());
  const status = state.halted ? "STOP DIÁRIO ATINGIDO" : state.position ? "POSICIONADO" : cooldown > 0 ? `COOLDOWN ${cooldown}s` : !running ? "ROBÔ PAUSADO" : "IA JEV ESCANEANDO";
  const updateSettings = (patch: Partial<Settings>) => {
    if (patch.real && !credentialsRef.current) { log("warn", "Teste a conexão com a Gate.io antes de ativar o Modo Real."); return; }
    state.settings = { ...state.settings, ...patch };
    save();
  };

  return {
    ...state,
    running,
    logs,
    candidates,
    selected,
    klines,
    status,
    order,
    connected: gate.connected,
    marketError: gate.error,
    lastUpdate: gate.lastUpdate,
    usdBrl: gate.usdBrl.current,
    realBalance,
    dexLastUpdate: dex.lastUpdate,
    cooldown,
    start: () => {
      if (state.halted) { log("warn", "Stop diário ativo — bloqueado até amanhã."); return; }
      if (state.settings.real && !credentialsRef.current) { log("warn", "Reconecte a Gate.io para operar em Modo Real."); return; }
      setRun(true);
      log("info", `IA Jev INICIADA em ${state.settings.real ? "MODO REAL" : "MODO SIMULAÇÃO"}.`);
    },
    stop: () => { setRun(false); log("info", "IA Jev PAUSADA. A posição aberta continua protegida pelos stops."); },
    closeNow: () => {
      const price = (state.position ? gate.market.current[state.position.id]?.price : 0) ?? 0;
      if (state.position && price > 0 && !busy.current) { busy.current = true; void closePosition(price, "Saída manual").finally(() => { busy.current = false; }); }
    },
    reset: () => {
      const settings = state.settings;
      store.current = { ...fresh(), settings };
      setRun(false);
      setOrder(null);
      save();
      log("info", "Banca de simulação reiniciada em 17,00 USDT (aprox. R$ 100,00).");
    },
    updateSettings,
    updateRealBalance,
  };
}

export const fmtP = (price: number) => price >= 1 ? price.toFixed(4) : price >= 0.01 ? price.toFixed(6) : price.toPrecision(4);
