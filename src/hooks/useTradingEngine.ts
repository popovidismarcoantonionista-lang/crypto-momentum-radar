import { useCallback, useEffect, useRef, useState } from "react";
import { useGateMarket } from "./useGateMarket";
import { useGateEvents } from "./useGateEvents";
import { useDexRadar } from "./useDexRadar";
import { getGateBookSnapshot, getGateOrder, placeGateOrder } from "@/lib/gateio.functions";
import type { GateCredentials, GateOrder } from "@/lib/gateio";
import { safetyCheck, scoreDex, type Kline, type Reason } from "@/lib/indicators";
import { COOLDOWN_MS, DEFAULT_JEV_SETTINGS, cooldownRemaining, evaluateJevExit, jevLevels, scoreJev, type JevSettings } from "@/lib/jev";
import { afterLatency, buyPaper, sellPaper, paperPnl, prefilter, spreadOf, rewardCheck, nextLosses, haltReason, performance, type BlockStatus, type ExecutionRecord, type Check } from "@/lib/paper";
import { leadLag } from "@/lib/leadlag";

export type Settings = JevSettings & { real: boolean; lock: string };
export type Position = { id: string; label: string; source: "GATE"; entry: number; tp: number; sl: number; peak: number; trailed: boolean; sizeUsdt: number; quantity: number; entryFee: number; score: number; reasons: Reason[]; openedAt: number; real: boolean; orderId?: string; pendingExit?: string };
export type Trade = ExecutionRecord;
export type Candidate = { id: string; label: string; source: "GATE" | "DEX"; price: number; change: number; score: number; reasons: Reason[]; safe: boolean; safeReason?: string | undefined; extra?: string; quoteVolume?: number; spread?: number | null; leadBonus?: number; leadAge?: number; blockedStatus?: BlockStatus; blockReason?: string };
export type Log = { t: number; kind: "scan" | "filter" | "buy" | "sell" | "warn" | "info"; msg: string };
type Ledger = { cash: number; day: string; dayStart: number; dayPnl: number; losses: number; halt: "meta" | "stop" | "perdas" | null; cooldownUntil: number; positions: Position[]; records: ExecutionRecord[]; equity: number[]; maxEquity: number; maxDrawdown: number };
type Store = { schema: 4; settings: Settings; paper: Ledger; live: Ledger; legacy: ExecutionRecord[]; legacyPosition: boolean };
const KEY = "ia-jev-trading-v4";
const OLD_KEY = "ia-jev-trading-v3";
const OLD_KEY_V2 = "ia-jev-trading-v2";
const today = () => new Date().toLocaleDateString("sv");
const freshLedger = (cash: number): Ledger => ({ cash, day: today(), dayStart: cash, dayPnl: 0, losses: 0, halt: null, cooldownUntil: 0, positions: [], records: [], equity: [cash], maxEquity: cash, maxDrawdown: 0 });
const fresh = (): Store => ({ schema: 4, settings: { ...DEFAULT_JEV_SETTINGS, weights: { ...DEFAULT_JEV_SETTINGS.weights }, real: false, lock: "AUTO" }, paper: freshLedger(17), live: freshLedger(0), legacy: [], legacyPosition: false });

export function useTradingEngine(credentials: GateCredentials | null) {
  const store = useRef<Store>(fresh());
  const [, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [order, setOrder] = useState<GateOrder | null>(null);
  const busy = useRef(false);
  const keys = useRef(credentials); keys.current = credentials;
  const lastScan = useRef("");
  const blocked = useRef(new Map<string, string>());
  const gate = useGateMarket(5);
  const events = useGateEvents(gate.market, true);
  const dex = useDexRadar(true, null);
  const log = useCallback((kind: Log["kind"], msg: string) => setLogs((list) => [...list.slice(-199), { t: Date.now(), kind, msg }]), []);
  const save = useCallback(() => { try { localStorage.setItem(KEY, JSON.stringify(store.current)); } catch { /* storage unavailable */ } setTick((v) => v + 1); }, []);
  const setRun = useCallback((value: boolean) => { runningRef.current = value; setRunning(value); }, []);
  useEffect(() => {
    const migrateLedger = (l: any): Ledger => {
      const positions = Array.isArray(l?.positions) ? l.positions : l?.position ? [l.position] : [];
      return { ...freshLedger(typeof l?.cash === "number" ? l.cash : 17), ...l, positions, records: Array.isArray(l?.records) ? l.records : [], equity: Array.isArray(l?.equity) ? l.equity : [typeof l?.cash === "number" ? l.cash : 17] };
    };
    try {
      const raw = localStorage.getItem(KEY);
      const oldRaw = !raw ? localStorage.getItem(OLD_KEY) : null;
      const parsed = raw ? JSON.parse(raw) as any : oldRaw ? JSON.parse(oldRaw) as any : null;
      if (parsed && (parsed.schema === 4 || parsed.schema === 3) && parsed.paper && parsed.live) {
        store.current = {
          ...fresh(),
          ...parsed,
          schema: 4,
          settings: { ...fresh().settings, ...parsed.settings, weights: { ...DEFAULT_JEV_SETTINGS.weights, ...parsed.settings?.weights } },
          paper: migrateLedger(parsed.paper),
          live: migrateLedger(parsed.live),
          legacy: Array.isArray(parsed.legacy) ? parsed.legacy : [],
          legacyPosition: Boolean(parsed.legacyPosition),
        };
      } else if (!raw && !oldRaw) {
        const v2 = localStorage.getItem(OLD_KEY_V2);
        if (v2) {
          const p2 = JSON.parse(v2) as { settings?: Partial<Settings>; paperBalance?: number; position?: { realQty?: string }; trades?: { time: number; pair: string; entry: number; exit: number; fee: number; pnl: number; score: number; reason: string }[] };
          store.current.settings = { ...fresh().settings, ...p2.settings, real: false, intervalSeconds: 5, weights: { ...DEFAULT_JEV_SETTINGS.weights, ...p2.settings?.weights } };
          store.current.paper = freshLedger(p2.paperBalance ?? 17);
          store.current.legacyPosition = Boolean(p2.position);
          store.current.legacy = (p2.trades ?? []).map((t, i) => ({ ...t, id: `legacy-${t.time}-${i}`, status: "Executada", mode: "LEGADO", reasons: [] }));
          log("warn", "[MIGRAÇÃO] Histórico anterior separado das métricas. Posição antiga, se existente, exige conferência; nenhuma liquidação fictícia será registrada.");
        }
      }
    } catch { log("warn", "Dados locais inválidos; configurações padrão carregadas."); }
    log("info", "IA Jev: paper por ask/bid, taxa 0,10% por lado. Múltiplas posições simultâneas habilitadas.");
    save();
  }, [log, save]);

  const recordBlock = useCallback((ledger: Ledger, pair: string, check: Extract<Check, { ok: false }>, score = 0, reasons: Reason[] = []) => {
    const key = `${store.current.settings.real}-${pair}`;
    if (blocked.current.get(key) === check.reason) return;
    blocked.current.set(key, check.reason);
    ledger.records = [{ id: crypto.randomUUID(), time: Date.now(), pair, status: check.status, mode: store.current.settings.real ? "REAL" : "PAPER", score, reasons, reason: check.reason }, ...ledger.records];
    log("filter", `[FILTRO] ${pair}: ${check.reason}`); save();
  }, [log, save]);

  const applyHalt = useCallback((ledger: Ledger) => {
    ledger.halt = haltReason(ledger.dayPnl, ledger.dayStart, store.current.settings.dailyGoalPct, store.current.settings.dailyStopPct, ledger.losses);
    if (ledger.halt) { setRun(false); log("warn", `[KILL SWITCH] ${ledger.halt === "meta" ? "Meta diária atingida" : ledger.halt === "stop" ? "Stop diário atingido" : "3 perdas consecutivas"}. Novas entradas bloqueadas.`); }
  }, [log, setRun]);

  const refreshBook = useCallback(async (symbol: string) => {
    const snapshot = await getGateBookSnapshot({ data: symbol });
    const previous = gate.market.current[symbol];
    if (!snapshot.bids.length || !snapshot.asks.length) throw new Error("Par sem livro atualizado no scanner; operação mantida sem execução.");
    const updated = {
      symbol,
      price: previous?.price ?? snapshot.bids[0]?.[0] ?? 0,
      change24: previous?.change24 ?? 0,
      quoteVolume: previous?.quoteVolume ?? 0,
      klines: previous?.klines ?? [],
      bids: snapshot.bids,
      asks: snapshot.asks,
      bookTime: snapshot.bookTime,
      ...(snapshot.rules ? { rules: { ...snapshot.rules, fetchedAt: snapshot.bookTime } } : previous?.rules ? { rules: previous.rules } : {}),
      ...(previous?.identity ? { identity: previous.identity } : {}),
    };
    gate.market.current[symbol] = updated;
    return updated;
  }, [gate.market]);

  const closePosition = useCallback(async (positionId: string, reason: string) => {
    const settings = store.current.settings;
    const ledger = settings.real ? store.current.live : store.current.paper;
    const position = ledger.positions.find((p) => p.id === positionId);
    if (!position || busy.current) return;
    busy.current = true;
    try {
      position.pendingExit = reason;
      const book = await afterLatency(position.real ? 0 : settings.latencyMs, () => refreshBook(position.id));
      const result = sellPaper(book, book.rules, position.quantity, Date.now());
      if (!result.ok) { recordBlock(ledger, position.id, result, position.score, position.reasons); return; }
      let fill = result.fill;
      if (position.real) {
        const creds = keys.current;
        if (!creds) { log("warn", "Reconecte suas chaves para vender; posição mantida."); return; }
        const response = await placeGateOrder({ data: { credentials: creds, symbol: position.id, side: "sell", amount: fill.quantity } });
        if (!response.ok) { log("warn", `[REAL] Venda recusada: ${response.error}`); return; }
        setOrder(response.order);
        if (response.order.status !== "CLOSED / EXECUTADA" || response.order.executedQty < position.quantity * 0.999999 || response.order.averagePrice <= 0) {
          position.orderId = response.order.orderId; position.pendingExit = "Ordem real pendente; confira a Gate.io"; setRun(false); log("warn", position.pendingExit); return;
        }
        if (response.order.feeCurrency !== "USDT") { setRun(false); log("warn", "Taxa real em outra moeda: conciliação necessária; posição mantida."); return; }
        fill = { ...fill, quantity: response.order.executedQty, notional: response.order.filledTotal, price: response.order.averagePrice, fee: response.order.fee };
      }
      const gross = fill.notional - position.sizeUsdt;
      const fee = position.entryFee + fill.fee;
      const pnl = gross - fee;
      const residue = position.quantity - fill.quantity;
      if (residue > 1e-9) { log("warn", `Resíduo de ${residue} unidades em ${position.id}; posição mantida para conciliação.`); setRun(false); return; }
      ledger.cash += fill.notional - fill.fee;
      ledger.dayPnl += pnl;
      ledger.losses = nextLosses(ledger.losses, pnl);
      ledger.records = [{ id: crypto.randomUUID(), time: Date.now(), pair: position.id, status: "Executada", mode: position.real ? "REAL" : "PAPER", score: position.score, reasons: position.reasons, entry: position.entry, exit: fill.price, gross, fee, entryFee: position.entryFee, exitFee: fill.fee, pnl, reason }, ...ledger.records];
      ledger.positions = ledger.positions.filter((p) => p !== position);
      ledger.cooldownUntil = Date.now() + COOLDOWN_MS;
      log("sell", `[VENDA] ${position.id} bid/média ${fmtP(fill.price)} | bruto ${gross.toFixed(4)} | taxas ${fee.toFixed(4)} | líquido ${pnl.toFixed(4)} USDT | cooldown 60s`);
      applyHalt(ledger); save();
    } catch (error) { log("warn", error instanceof Error ? error.message : "Falha de execução; posição mantida"); }
    finally { busy.current = false; save(); }
  }, [applyHalt, log, recordBlock, refreshBook, save, setRun]);

  useEffect(() => {
    let active = true;
    const analyze = async () => {
      if (!active) return;
      const state = store.current, settings = state.settings;
      const ledger = settings.real ? state.live : state.paper;
      const now = Date.now();
      if (ledger.day !== today()) { const allocated = ledger.positions.reduce((s, p) => s + p.sizeUsdt + p.entryFee, 0); ledger.day = today(); ledger.dayPnl = 0; ledger.dayStart = ledger.cash + allocated; if (ledger.halt !== "perdas") ledger.halt = null; log("info", "Novo dia: limites diários reiniciados."); save(); }
      const list: Candidate[] = [];
      for (const item of Object.values(gate.market.current)) {
        const filter = prefilter(item, item.quoteVolume, now);
        const spread = spreadOf(item);
        if (!filter.ok) {
          list.push({ id: item.symbol, label: item.symbol, source: "GATE", price: item.price, change: item.change24, score: 0, reasons: [], safe: false, safeReason: filter.reason, quoteVolume: item.quoteVolume, spread, blockedStatus: filter.status, blockReason: filter.reason, extra: `Vol $${Math.round(item.quoteVolume / 1000)}k` });
          if (runningRef.current) recordBlock(ledger, item.symbol, filter);
          continue;
        }
        blocked.current.delete(`${store.current.settings.real}-${item.symbol}`);
        const analysis = scoreJev(item, settings.weights, now);
        let bonus = 0, age = 0;
        const latest = item.klines.at(-1), previous = item.klines.at(-2);
        const gateChange = latest && previous && previous.c > 0 ? (latest.c / previous.c - 1) * 100 : Infinity;
        const baseSymbol = item.symbol.replace(/_USDT$/, "");
        for (const pair of dex.pairs.current) {
          const identity = dex.identities.current[pair.id];
          if (!identity || !safetyCheck(pair).ok) continue;
          const sameToken = item.identity ? (item.identity.chain === identity.chain && item.identity.address.toLowerCase() === identity.address.toLowerCase()) : pair.symbol.toUpperCase() === baseSymbol.toUpperCase();
          if (!sameToken) continue;
          const signal = leadLag(dex.samples.current[pair.id] ?? [], item.identity ?? { chain: identity.chain, address: `symbol:${baseSymbol.toUpperCase()}` }, { ...identity, address: item.identity ? identity.address : `symbol:${baseSymbol.toUpperCase()}` }, gateChange, now);
          if (signal.bonus > bonus) { bonus = signal.bonus; age = signal.age; }
        }
        const reasons = bonus ? [...analysis.reasons, { ok: true, text: `Lead-Lag Dex verificado: +${bonus} pts (Dex ${age < 15000 ? "recente" : "atualizado"})`, pts: bonus, max: 10 }] : analysis.reasons;
        list.push({ id: item.symbol, label: item.symbol, source: "GATE", price: item.price, change: item.change24, score: Math.min(100, analysis.score + bonus), reasons, safe: analysis.safe, safeReason: analysis.safeReason, quoteVolume: item.quoteVolume, spread, leadBonus: bonus, leadAge: age, extra: `Vol $${Math.round(item.quoteVolume / 1000)}k` });
      }
      for (const pair of dex.pairs.current) { const safety = safetyCheck(pair); const analysis = scoreDex(pair, ledger.cash); list.push({ id: pair.id, label: `${pair.symbol}/${pair.chain === "solana" ? "SOL" : "BASE"}`, source: "DEX", price: pair.price, change: pair.ch5m, score: safety.ok ? analysis.score : 0, reasons: analysis.reasons, safe: safety.ok, safeReason: safety.reason, extra: `Liq $${Math.round(pair.liquidity / 1000)}k · Vol1h $${Math.round(pair.vol1h / 1000)}k` }); }
      list.sort((a, b) => a.id === "PEARL_USDT" ? -1 : b.id === "PEARL_USDT" ? 1 : b.score - a.score); setCandidates(list);
      let equityValue = ledger.cash;
      for (const pos of ledger.positions) {
        const mkt = gate.market.current[pos.id];
        const mark = mkt ? sellPaper(mkt, mkt.rules, pos.quantity, now) : null;
        equityValue += mark?.ok ? mark.fill.notional - mark.fill.fee : pos.sizeUsdt;
      }
      if (ledger.positions.length === 0 || ledger.positions.every((pos) => { const m = gate.market.current[pos.id]; return !m || sellPaper(m, m.rules, pos.quantity, now).ok; })) {
        ledger.maxEquity = Math.max(ledger.maxEquity, equityValue);
        if (ledger.maxEquity > 0) ledger.maxDrawdown = Math.max(ledger.maxDrawdown, (ledger.maxEquity - equityValue) / ledger.maxEquity * 100);
        ledger.equity = [...ledger.equity.slice(-1999), equityValue];
      }
      let closedAny = false;
      for (const pos of [...ledger.positions]) {
        const mkt = gate.market.current[pos.id];
        const bid = mkt?.bids[0]?.[0];
        if (!bid || !mkt?.bookTime || now - mkt.bookTime >= 10_000 || busy.current) continue;
        if (pos.pendingExit && !pos.real) { void closePosition(pos.id, pos.pendingExit); closedAny = true; break; }
        const decision = evaluateJevExit(pos, bid, settings);
        pos.peak = decision.peak; pos.sl = decision.sl; pos.trailed = decision.trailed;
        if (decision.action === "tp" || decision.action === "sl") { void closePosition(pos.id, decision.reason ?? "Stop Loss"); closedAny = true; break; }
      }
      if (ledger.positions.length > 0) setTick((v) => v + 1);
      if (closedAny) return;
      const maxPositions = Math.max(1, Math.min(10, Math.floor(settings.maxPositions || 1)));
      const slotsFree = maxPositions - ledger.positions.length;
      const scanKey = `${gate.version}-${events.eventVersion}-${dex.version}-${ledger.positions.map((p) => p.id).join(",")}`;
      if (!runningRef.current || ledger.halt || state.legacyPosition || busy.current || now < ledger.cooldownUntil || slotsFree <= 0 || scanKey === lastScan.current) return;
      lastScan.current = scanKey;
      applyHalt(ledger); if (ledger.halt) return;
      const openIds = new Set(ledger.positions.map((p) => p.id));
      const pool = list.filter((c) => c.source === "GATE" && c.safe && !openIds.has(c.id) && (settings.lock === "AUTO" || c.id === settings.lock)).sort((a, b) => b.score - a.score);
      const best = pool[0];
      if (!best || best.score < settings.trigger) { log("scan", `[SCAN] ${pool.length} pares elegíveis | slots ${slotsFree}/${maxPositions} | melhor ${best?.label ?? "—"} ${best?.score ?? 0}% | limiar ${settings.trigger}%`); return; }
      busy.current = true;
      try {
        const book = await afterLatency(settings.real ? 0 : settings.latencyMs, () => refreshBook(best.id));
        if (!runningRef.current || state.settings.real !== settings.real || ledger.halt || !active) return;
        if (ledger.positions.some((p) => p.id === best.id) || ledger.positions.length >= maxPositions) return;
        const filter = prefilter(book, book.quoteVolume, Date.now());
        if (!filter.ok) { recordBlock(ledger, best.id, filter, best.score, best.reasons); return; }
        const intended = settings.handMode === "fixed" ? settings.fixedUsdt : ledger.cash * settings.allocation;
        const result = buyPaper(book, book.rules, ledger.cash, intended, Date.now());
        if (!result.ok) { recordBlock(ledger, best.id, result, best.score, best.reasons); return; }
        const reward = rewardCheck(settings.tp, spreadOf(book) ?? Infinity, result.fill.slippagePct);
        if (!reward.ok) { recordBlock(ledger, best.id, reward, best.score, best.reasons); return; }
        let fill = result.fill;
        let orderId: string | undefined;
        if (settings.real) {
          const creds = keys.current; if (!creds) return;
          const response = await placeGateOrder({ data: { credentials: creds, symbol: best.id, side: "buy", amount: fill.notional } });
          if (!response.ok) { log("warn", `[REAL] ${response.error}`); return; }
          setOrder(response.order); orderId = response.order.orderId;
          if (response.order.status !== "CLOSED / EXECUTADA" || response.order.executedQty <= 0 || response.order.feeCurrency !== "USDT") { setRun(false); state.legacyPosition = true; log("warn", "Ordem real exige conciliação na Gate.io; automação bloqueada."); return; }
          fill = { ...fill, price: response.order.averagePrice, quantity: response.order.executedQty, notional: response.order.filledTotal, fee: response.order.fee, debit: response.order.filledTotal + response.order.fee };
        }
        ledger.cash -= fill.debit;
        ledger.positions.push({ id: best.id, label: best.label, source: "GATE", entry: fill.price, ...jevLevels(fill.price, settings), peak: fill.price, trailed: false, sizeUsdt: fill.notional, quantity: fill.quantity, entryFee: fill.fee, score: best.score, reasons: best.reasons, openedAt: Date.now(), real: settings.real, ...(orderId ? { orderId } : {}) });
        blocked.current.delete(`${settings.real}-${best.id}`);
        log("buy", `[COMPRA ${settings.real ? "REAL" : "PAPER"}] ${best.id} ask/média ${fmtP(fill.price)} | ${fill.notional.toFixed(4)} USDT | taxa ${fill.fee.toFixed(4)} | IA ${best.score}% | slots ${ledger.positions.length}/${maxPositions}${fill.adjusted ? " | mão ajustada ao mínimo" : ""}`); save();
      } catch (error) { log("warn", error instanceof Error ? error.message : "Falha ao atualizar o livro"); }
      finally { busy.current = false; }
    };
    void analyze(); const interval = setInterval(() => void analyze(), 1000);
    return () => { active = false; clearInterval(interval); };
  }, [applyHalt, closePosition, dex.identities, dex.pairs, dex.samples, dex.version, events.eventVersion, gate.market, gate.version, log, recordBlock, refreshBook, save, setRun]);

  useEffect(() => {
    if (!order || order.status !== "OPEN" || !credentials) return;
    const interval = setInterval(async () => { const response = await getGateOrder({ data: { credentials, symbol: order.symbol, orderId: order.orderId } }); if (response.ok) setOrder(response.order); }, 3000);
    return () => clearInterval(interval);
  }, [credentials, order]);
  const state = store.current, ledger = state.settings.real ? state.live : state.paper;
  const selectedId = ledger.positions[0]?.id ?? (state.settings.lock !== "AUTO" ? state.settings.lock : "PEARL_USDT");
  const selected = candidates.find((c) => c.id === selectedId) ?? candidates.find((c) => c.source === "GATE") ?? null;
  const klines: Kline[] = selected ? gate.market.current[selected.id]?.klines ?? [] : [];
  const positionsView = ledger.positions.map((pos) => {
    const mkt = gate.market.current[pos.id];
    const liq = mkt ? sellPaper(mkt, mkt.rules, pos.quantity, Date.now()) : null;
    const pnl = liq?.ok ? paperPnl(pos.sizeUsdt, pos.entryFee, pos.quantity, liq.fill.price) : null;
    return { ...pos, currentPrice: liq?.ok ? liq.fill.price : 0, pnl, liquidationOk: Boolean(liq?.ok) };
  });
  const equity = ledger.cash + positionsView.reduce((sum, pos) => sum + (pos.liquidationOk && pos.pnl ? pos.sizeUsdt + pos.pnl.gross - pos.entryFee - (pos.pnl.exitFee ?? 0) : pos.sizeUsdt), 0);
  const cooldown = cooldownRemaining(ledger.cooldownUntil, Date.now());
  const status = ledger.halt === "stop" ? "STOP DIÁRIO ATINGIDO" : ledger.halt === "meta" ? "META DIÁRIA ATINGIDA" : ledger.halt === "perdas" ? "3 PERDAS CONSECUTIVAS" : state.legacyPosition ? "CONFERIR POSIÇÃO ANTERIOR" : ledger.positions.length ? `${ledger.positions.length} POSIÇÃO(ÕES)` : cooldown > 0 ? `COOLDOWN ${cooldown}s` : running ? "IA JEV ESCANEANDO" : "ROBÔ PAUSADO";
  const metrics = performance(ledger.records, ledger.equity);
  const updateSettings = (patch: Partial<Settings>) => {
    if (busy.current || state.paper.positions.length || state.live.positions.length) { log("warn", "Ajustes bloqueados durante posições abertas ou execução; feche as operações primeiro."); return; }
    if (patch.real && !keys.current) { log("warn", "Conecte a Gate.io antes de selecionar dinheiro real."); return; }
    const next = { ...state.settings, ...patch, intervalSeconds: 5, autoPause: true, maxPositions: Math.max(1, Math.min(10, Math.floor(Number(patch.maxPositions ?? state.settings.maxPositions ?? 3)))) };
    if (![next.tp, next.sl, next.fixedUsdt, next.dailyGoalPct, next.dailyStopPct, next.trailTrigger, next.trailDistance, next.maxPositions].every((n) => Number.isFinite(n) && n > 0) || !Number.isFinite(next.latencyMs) || next.latencyMs < 0 || next.latencyMs > 10_000 || next.allocation <= 0 || next.allocation > 1) { log("warn", "Parâmetros inválidos; alteração não aplicada."); return; }
    state.settings = next; lastScan.current = ""; save();
  };
  return { settings: state.settings, positions: positionsView, position: positionsView[0] ?? null, paperBalance: state.settings.real ? state.paper.cash : equity, realBalance: state.settings.real ? equity : state.live.cash, cash: ledger.cash, dayStart: ledger.dayStart, dayPnl: ledger.dayPnl, trades: ledger.records, legacyTrades: state.legacy, legacyPosition: state.legacyPosition, halted: Boolean(ledger.halt), halt: ledger.halt, losses: ledger.losses, running, logs, candidates, selected, klines, status, order, openPnl: positionsView[0]?.pnl ?? null, currentPrice: positionsView[0]?.currentPrice ?? 0, metrics: { ...metrics, fees: metrics.fees + ledger.positions.reduce((s, p) => s + p.entryFee, 0), drawdown: ledger.equity.length > 1 ? ledger.maxDrawdown : null }, connected: gate.connected, eventConnected: events.connected, marketError: gate.error, lastUpdate: gate.lastUpdate, usdBrl: gate.usdBrl.current, dexLastUpdate: dex.lastUpdate, cooldown, metadataReady: Boolean(selected && gate.market.current[selected.id]?.rules), updateSettings,
    updateRealBalance: (value: number) => { if (!state.live.positions.length) { state.live.cash = value; if (!state.live.records.length) state.live.dayStart = value; save(); } },
    start: () => { applyHalt(ledger); if (ledger.halt || state.legacyPosition || busy.current) { log("warn", "Trava ativa; confira o alerta antes de retomar."); return; } if (state.settings.real && !keys.current) { log("warn", "Reconecte a Gate.io."); return; } setRun(true); lastScan.current = ""; log("info", `IA Jev iniciada em ${state.settings.real ? "REAL" : "PAPER"}.`); },
    stop: () => { setRun(false); log("info", "Motor pausado; proteção da posição permanece ativa."); },
    closeNow: (positionId?: string) => { const id = positionId ?? ledger.positions[0]?.id; if (id) void closePosition(id, "Saída manual"); },
    resumeLosses: () => { if (ledger.halt !== "perdas" || ledger.positions.length || busy.current) return; ledger.losses = 0; ledger.halt = null; save(); log("info", "Trava de perdas rearmada explicitamente; motor permanece pausado."); },
    reset: () => { if (busy.current || state.paper.positions.length || state.live.positions.length || state.settings.real) { log("warn", "Reinício bloqueado: posição/execução ativa ou modo real selecionado."); return; } state.paper = freshLedger(17); state.legacyPosition = false; setRun(false); blocked.current.clear(); save(); log("info", "Simulação reiniciada em 17 USDT. Histórico legado preservado separadamente."); },
  };
}
export const fmtP = (price: number) => price >= 1 ? price.toFixed(4) : price >= 0.01 ? price.toFixed(6) : price.toPrecision(4);
