import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Activity, Bot, BrainCircuit, CircleDollarSign, Crosshair, Flame, Gauge as GaugeIcon, History, KeyRound, Pause, Play, Radar, RotateCcw, Settings2, ShieldAlert, ShieldCheck, SquareArrowOutUpRight, Terminal, Wifi, WifiOff } from "lucide-react";
import { fmtP, useTradingEngine } from "@/hooks/useTradingEngine";
import { Card, CandleChart, Gauge, Reasons } from "@/components/bot/Widgets";
import { SettingsModal } from "@/components/bot/SettingsModal";
import { testGateConnection } from "@/lib/gateio.functions";
import type { GateCredentials, GateOrder } from "@/lib/gateio";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "IA Jev Trading Bot — Gate.io & Memecoins" },
      { name: "description", content: "Robô automático IA Jev para Gate.io com scanner de memecoins, gestão de risco, trailing stop e radar DexScreener." },
      { property: "og:title", content: "IA Jev Trading Bot" },
      { property: "og:description", content: "Entrada e saída automática na Gate.io com certeza configurável e proteção anti-topo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const usdt = (value: number) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`;
const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Dashboard() {
  const [credentials, setCredentials] = useState<GateCredentials | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scannerTab, setScannerTab] = useState<"GATE" | "DEX">("GATE");
  const engine = useTradingEngine(credentials);
  const balance = engine.settings.real ? engine.realBalance : engine.paperBalance;
  const goal = engine.dayStart * (engine.settings.dailyGoalPct / 100);
  const goalProgress = Math.max(0, Math.min(100, goal > 0 ? (engine.dayPnl / goal) * 100 : 0));
  const currentPrice = engine.currentPrice || (engine.position ? engine.candidates.find((candidate) => candidate.id === engine.position?.id)?.price ?? 0 : 0);
  const openPnl = engine.openPnl;

  const handleTest = async (keys: GateCredentials) => {
    const result = await testGateConnection({ data: { credentials: keys } });
    if (result.ok) {
      setCredentials(keys);
      engine.updateRealBalance(result.available);
    } else setCredentials(null);
    return result;
  };

  const statusTone = engine.status.startsWith("STOP") ? "border-sell/40 bg-sell/15 text-sell" : engine.status === "POSICIONADO" ? "border-buy/40 bg-buy/15 text-buy" : "border-primary/40 bg-primary/10 text-primary";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><BrainCircuit className="h-6 w-6" /><span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full border-2 border-background bg-buy" /></div>
            <div><h1 className="text-base font-bold tracking-tight sm:text-lg">IA Jev <span className="text-primary">Trading Bot</span></h1><div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{engine.connected ? <Wifi className="h-3 w-3 text-buy" /> : <WifiOff className="h-3 w-3 text-sell" />}Gate.io Spot · {engine.lastUpdate ? new Date(engine.lastUpdate).toLocaleTimeString("pt-BR") : "conectando"}</div></div>
          </div>
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide ${engine.settings.real ? "border-sell/50 bg-sell/15 text-sell" : "border-primary/40 bg-primary/10 text-primary"}`}><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{engine.settings.real ? "AUTO-TRADE REAL ATIVO" : "MODO SIMULAÇÃO"}</span>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <div className="hidden text-right sm:block"><div className="text-[9px] uppercase tracking-wider text-muted-foreground">Saldo {engine.settings.real ? "real" : "simulado"}</div><div className="num text-sm font-bold">{usdt(balance)}</div><div className="num text-[10px] text-muted-foreground">≈ {brl(balance * engine.usdBrl)}</div></div>
            <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-semibold hover:bg-accent"><Settings2 className="h-4 w-4 text-primary" /><span className="hidden md:inline">Configurações & IA Jev</span></button>
            {engine.running ? <button onClick={engine.stop} className="flex items-center gap-2 rounded-lg bg-sell px-3 py-2.5 text-xs font-bold text-destructive-foreground sm:px-4"><Pause className="h-4 w-4" />Pausar</button> : <button onClick={engine.start} className="glow-buy flex items-center gap-2 rounded-lg bg-buy px-3 py-2.5 text-xs font-bold text-primary-foreground sm:px-4"><Play className="h-4 w-4" />Ligar IA Jev</button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] space-y-4 p-3 sm:p-4">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Banca atual" value={usdt(balance)} detail={brl(balance * engine.usdBrl)} icon={<CircleDollarSign className="h-4 w-4 text-primary" />} />
          <Metric label="Resultado do dia" value={`${engine.dayPnl >= 0 ? "+" : ""}${usdt(engine.dayPnl)}`} detail={`Meta +${usdt(goal)} · Stop -${engine.settings.dailyStopPct}%`} tone={engine.dayPnl >= 0 ? "buy" : "sell"} icon={<Activity className="h-4 w-4 text-primary" />} progress={goalProgress} />
          <Metric label="Estado do motor" value={engine.status} detail={engine.cooldown > 0 ? "Nova entrada liberada após o resfriamento" : `Análises a cada ${engine.settings.intervalSeconds}s`} icon={<Bot className="h-4 w-4 text-primary" />} small />
          <Metric label="Certeza / Limiar" value={`${engine.selected?.source === "GATE" ? engine.selected.score : 0}% / ${engine.settings.trigger}%`} detail={engine.selected?.source === "GATE" ? engine.selected.label : "Selecione um par Gate.io"} icon={<GaugeIcon className="h-4 w-4 text-primary" />} />
        </section>

        {engine.marketError && <div className="rounded-lg border border-sell/30 bg-sell/10 px-4 py-2 text-xs text-sell">{engine.marketError}</div>}
        {engine.halted && <div className="flex items-center gap-2 rounded-lg border border-sell/40 bg-sell/15 px-4 py-3 text-xs font-semibold text-sell"><ShieldAlert className="h-4 w-4" />Kill Switch ativo: {engine.halt === "meta" ? "Meta diária atingida" : engine.halt === "stop" ? "Stop diário atingido" : "3 perdas consecutivas"}. Motor pausado automaticamente; novas entradas bloqueadas.</div>}
        {engine.settings.real && !credentials && <div className="flex items-center gap-2 rounded-lg border border-sell/30 bg-sell/10 px-4 py-3 text-xs text-sell"><KeyRound className="h-4 w-4" />Modo Real salvo, mas as chaves precisam ser reconectadas em Configurações antes de operar ou vender.</div>}

        <div className="grid items-start gap-4 xl:grid-cols-[310px_minmax(0,1fr)_340px]">
          <div className="space-y-4 min-w-0">
            <Card title="Scanner Global" icon={<Radar className="h-4 w-4 text-primary" />} right={<span className="num text-[10px] text-muted-foreground">{engine.settings.intervalSeconds}s</span>}>
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                <button onClick={() => setScannerTab("GATE")} className={`rounded-md px-2 py-2 text-xs font-bold ${scannerTab === "GATE" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Gate.io + PEARL</button>
                <button onClick={() => setScannerTab("DEX")} className={`rounded-md px-2 py-2 text-xs font-bold ${scannerTab === "DEX" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>DexScreener</button>
              </div>
              {scannerTab === "GATE" ? <GateScanner engine={engine} /> : <DexScanner engine={engine} />}
            </Card>

            <Card title="Proteções Automáticas" icon={<ShieldCheck className="h-4 w-4 text-primary" />}>
              <div className="grid grid-cols-2 gap-2 text-[11px] num">
                <div className="rounded-lg bg-muted p-3">Take Profit<b className="mt-1 block text-buy">+{engine.settings.tp}%</b></div>
                <div className="rounded-lg bg-muted p-3">Stop Loss<b className="mt-1 block text-sell">-{engine.settings.sl}%</b></div>
                <div className="rounded-lg bg-muted p-3">Trailing ativa<b className="mt-1 block text-buy">+{engine.settings.trailTrigger}%</b></div>
                <div className="rounded-lg bg-muted p-3">Distância do pico<b className="mt-1 block text-primary">{engine.settings.trailDistance}%</b></div>
              </div>
              <ul className="mt-3 space-y-2 text-[11px] text-muted-foreground"><li>• Filtro anti-topo acima de +15% em 15m</li><li>• Pullback exigido: 1,5%–2,5% com volume</li><li>• Taxa de 0,2% descontada do resultado</li><li>• Cooldown de 60s após cada saída</li></ul>
              <button onClick={() => window.confirm("Reiniciar apenas a banca e o histórico da simulação?") && engine.reset()} className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><RotateCcw className="h-3 w-3" />Reiniciar simulação</button>
            </Card>
          </div>

          <div className="space-y-4 min-w-0">
            <OpenPosition engine={engine} currentPrice={currentPrice} pnl={openPnl} />
            <Card title={engine.selected ? `${engine.selected.label} · ${engine.selected.source === "GATE" ? "velas 1m" : "amostras DEX"}` : "Gráfico ao vivo"} icon={<Flame className="h-4 w-4 text-primary" />} right={engine.selected && <span className="num text-sm font-bold">{fmtP(engine.selected.price)}</span>}>
              <CandleChart klines={engine.klines} position={engine.position && engine.selected?.id === engine.position.id ? engine.position : null} />
            </Card>
            <OrderStatus order={engine.order} real={engine.settings.real} />
            <LogTerminal logs={engine.logs} />
          </div>

          <div className="space-y-4 min-w-0">
            <Card title="Painel da IA Jev" icon={<BrainCircuit className="h-4 w-4 text-primary" />} right={<span className="max-w-32 truncate text-[10px] text-muted-foreground">{engine.selected?.label}</span>}>
              <Gauge score={engine.selected?.score ?? 0} trigger={engine.settings.trigger} />
              {engine.selected && !engine.selected.safe && <p className="mb-3 flex gap-2 rounded-lg border border-sell/30 bg-sell/10 p-2 text-[11px] leading-relaxed text-sell"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{engine.selected.safeReason}</p>}
              <Reasons reasons={engine.selected?.reasons ?? []} />
              <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">A compra só é liberada quando a certeza atinge <b className="text-foreground">{engine.settings.trigger}%</b>, o par passa no anti-topo e o volume 24h supera $100 mil.</div>
            </Card>
            <Card title="Estado da Conexão" icon={<Activity className="h-4 w-4 text-primary" />}>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Gate.io pública</span><span className={`flex items-center gap-1.5 font-semibold ${engine.connected ? "text-buy" : "text-sell"}`}>{engine.connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{engine.connected ? "ATUALIZANDO" : "DESCONECTADA"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Conta real</span><span className={credentials ? "font-semibold text-buy" : "text-muted-foreground"}>{credentials ? "CHAVES NA SESSÃO" : "NÃO CONECTADA"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">USDT/BRL</span><span className="num">{engine.usdBrl.toFixed(3)}</span></div>
                <button onClick={() => setSettingsOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 font-semibold hover:bg-accent"><KeyRound className="h-4 w-4 text-primary" />Configurar Gate.io</button>
              </div>
            </Card>
          </div>
        </div>
        <Trades trades={engine.trades} />
        <PerformanceCard metrics={engine.metrics} />
        <p className="pb-4 text-center text-[10px] leading-relaxed text-muted-foreground">Criptomoedas e memecoins envolvem risco elevado. A IA Jev automatiza regras, não garante lucro. Teste em simulação antes de ativar ordens reais.</p>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={engine.settings} onSettings={engine.updateSettings} onTest={handleTest} realBalance={engine.realBalance} />
    </div>
  );
}

function Metric({ label, value, detail, icon, tone = "", progress, small = false }: { label: string; value: string; detail: string; icon: React.ReactNode; tone?: string; progress?: number; small?: boolean }) {
  return <div className="rounded-xl border border-border bg-card p-3 sm:p-4"><div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground"><span>{label}</span>{icon}</div><div className={`num font-bold ${small ? "text-[11px] sm:text-xs" : "text-sm sm:text-lg"} ${tone === "buy" ? "text-buy" : tone === "sell" ? "text-sell" : ""}`}>{value}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</div>{progress !== undefined && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-buy transition-all" style={{ width: `${progress}%` }} /></div>}</div>;
}

function GateScanner({ engine }: { engine: ReturnType<typeof useTradingEngine> }) {
  const pairs = engine.candidates.filter((candidate) => candidate.source === "GATE");
  return <>
    <button onClick={() => engine.updateSettings({ lock: "AUTO" })} className={`mb-2 w-full rounded-md px-2 py-1.5 text-[10px] font-bold ${engine.settings.lock === "AUTO" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>AUTO-CAÇADOR — PARES USDT FILTRADOS</button>
    <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 text-[9px] uppercase tracking-wider text-muted-foreground"><span>Par</span><span>Vol 24h</span><span>Spread</span><span>Score</span></div>
    <ul className="-mx-2 max-h-[540px] space-y-1 overflow-y-auto px-1">
      {pairs.length === 0 && <li className="p-4 text-center text-xs text-muted-foreground">Varrendo pares USDT da Gate.io...</li>}
      {pairs.map((candidate) => {
        const blocked = Boolean(candidate.blockedStatus);
        const spreadPct = candidate.spread == null ? null : candidate.spread * 100;
        return <li key={candidate.id}><button onClick={() => engine.updateSettings({ lock: engine.settings.lock === candidate.id ? "AUTO" : candidate.id })} className={`w-full rounded-lg px-2 py-2 text-left hover:bg-accent ${engine.settings.lock === candidate.id ? "bg-accent ring-1 ring-primary" : ""} ${blocked ? "border border-sell/30 bg-sell/5" : ""}`}>
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
            <span className="min-w-0 truncate text-xs font-semibold">{candidate.id === "PEARL_USDT" && <span className="mr-1 rounded bg-primary/15 px-1 text-[8px] text-primary">PRIORIDADE</span>}{candidate.label.replace("_USDT", "")}</span>
            <span className={`num text-[10px] ${blocked && candidate.blockedStatus === "Bloqueada por Liquidez" ? "text-sell font-semibold" : "text-muted-foreground"}`}>${Math.round((candidate.quoteVolume ?? 0) / 1000)}k</span>
            <span className={`num text-[10px] ${spreadPct != null && spreadPct > 0.15 ? "text-sell font-semibold" : "text-muted-foreground"}`}>{spreadPct == null ? "—" : `${spreadPct.toFixed(3)}%`}</span>
            <span className={`num w-8 text-right text-xs font-bold ${blocked ? "text-sell" : candidate.score >= engine.settings.trigger ? "text-buy" : "text-foreground"}`}>{blocked ? "BLQ" : candidate.score}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded bg-muted"><span className={`block h-full ${blocked ? "bg-sell" : candidate.safe ? "bg-primary" : "bg-sell"}`} style={{ width: `${blocked ? 100 : candidate.score}%` }} /></span>
            <span className={`truncate text-[9px] ${blocked ? "text-sell" : "text-muted-foreground"}`}>{blocked ? candidate.blockReason : candidate.extra}</span>
          </div>
        </button></li>;
      })}
    </ul>
  </>;
}

function DexScanner({ engine }: { engine: ReturnType<typeof useTradingEngine> }) {
  const pairs = engine.candidates.filter((candidate) => candidate.source === "DEX");
  return <><p className="mb-2 text-[10px] text-muted-foreground">Solana e Base · atualização 15s · liquidez mínima $50k · somente monitoramento</p><ul className="-mx-2 max-h-[540px] space-y-1 overflow-y-auto">{pairs.length === 0 && <li className="p-4 text-center text-xs text-muted-foreground">Buscando lançamentos na DexScreener...</li>}{pairs.map((candidate) => <li key={candidate.id} className={`rounded-lg px-2 py-2 ${candidate.safe ? "" : "opacity-65"}`}><div className="flex items-center gap-2">{candidate.safe ? <ShieldCheck className="h-3.5 w-3.5 text-buy" /> : <ShieldAlert className="h-3.5 w-3.5 text-sell" />}<span className="flex-1 truncate text-xs font-semibold">{candidate.label}</span><span className={`num text-[10px] ${candidate.change >= 0 ? "text-buy" : "text-sell"}`}>{candidate.change.toFixed(1)}% 5m</span></div><div className="num mt-1 pl-5 text-[9px] text-muted-foreground">{candidate.safe ? candidate.extra : `Reprovado: ${candidate.safeReason}`}</div></li>)}</ul></>;
}

function OpenPosition({ engine, currentPrice, pnl }: { engine: ReturnType<typeof useTradingEngine>; currentPrice: number; pnl: { fee: number; pnl: number } | null }) {
  const position = engine.position;
  if (!position) return <Card title="Posição Aberta Agora" icon={<Crosshair className="h-4 w-4 text-primary" />} right={<span className="rounded-full bg-muted px-2 py-1 text-[9px] font-bold text-muted-foreground">SEM POSIÇÃO</span>}><div className="flex flex-col items-center justify-center gap-2 py-5 text-center"><Crosshair className="h-8 w-8 text-muted-foreground" /><p className="text-sm font-semibold">Aguardando uma entrada da IA Jev</p><p className="max-w-md text-xs text-muted-foreground">Ao atingir {engine.settings.trigger}% de certeza e passar nos filtros, a compra {engine.settings.real ? "real" : "simulada"} será enviada automaticamente.</p></div></Card>;
  const progress = currentPrice > 0 ? Math.max(0, Math.min(100, ((currentPrice - position.sl) / Math.max(position.tp - position.sl, Number.EPSILON)) * 100)) : 0;
  return <Card title="Posição Aberta Agora" icon={<Crosshair className="h-4 w-4 text-buy" />} right={<span className="flex items-center gap-1.5 rounded-full bg-buy/15 px-2 py-1 text-[9px] font-bold text-buy"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-buy" />MONITORANDO TICK-A-TICK</span>}>
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xl font-bold">{position.label}</div><div className="text-[10px] text-muted-foreground">Aberta às {new Date(position.openedAt).toLocaleTimeString("pt-BR")} · IA {position.score}%</div></div><div className={`num text-xl font-bold ${pnl && pnl.pnl >= 0 ? "text-buy" : "text-sell"}`}>{pnl ? `${pnl.pnl >= 0 ? "+" : ""}${usdt(pnl.pnl)}` : "—"}</div></div>
    <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><span className="text-muted-foreground">Entrada<b className="num mt-1 block text-foreground">{fmtP(position.entry)}</b></span><span className="text-muted-foreground">Preço ao vivo<b className="num mt-1 block text-foreground">{currentPrice ? fmtP(currentPrice) : "—"}</b></span><span className="text-muted-foreground">Capital<b className="num mt-1 block text-foreground">{usdt(position.sizeUsdt)}</b></span><span className="text-muted-foreground">P/L em reais<b className={`num mt-1 block ${pnl && pnl.pnl >= 0 ? "text-buy" : "text-sell"}`}>{pnl ? brl(pnl.pnl * engine.usdBrl) : "—"}</b></span></div>
    <div className="mt-4"><div className="mb-1 flex justify-between text-[10px] num"><span className="text-sell">SL {fmtP(position.sl)}</span><span className="text-muted-foreground">{position.trailed ? "TRAILING ATIVO" : "STOP FIXO"}</span><span className="text-buy">TP {fmtP(position.tp)}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div></div>
    <div className="mt-4 flex items-center justify-between gap-3"><span className="text-[10px] text-muted-foreground">Taxa estimada {pnl ? usdt(pnl.fee) : "—"} · Pico {fmtP(position.peak)}</span><button onClick={engine.closeNow} className="rounded-lg bg-sell px-4 py-2 text-xs font-bold text-destructive-foreground">Vender agora</button></div>
  </Card>;
}

function OrderStatus({ order, real }: { order: GateOrder | null; real: boolean }) {
  const tone = order?.status === "CLOSED / EXECUTADA" ? "text-buy" : order?.status === "ERRO" || order?.status === "CANCELLED" ? "text-sell" : "text-primary";
  return <Card title="Status da Ordem na Corretora" icon={<SquareArrowOutUpRight className="h-4 w-4 text-primary" />} right={<span className={`text-[10px] font-bold ${order ? tone : "text-muted-foreground"}`}>{order?.status ?? (real ? "AGUARDANDO ORDEM" : "SEM ORDEM REAL")}</span>}>
    {order ? <><div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><span className="text-muted-foreground">ID real da ordem<b className="num mt-1 block break-all text-foreground">{order.orderId}</b></span><span className="text-muted-foreground">Par / Lado<b className="mt-1 block text-foreground">{order.symbol} · {order.side.toUpperCase()}</b></span><span className="text-muted-foreground">Preço médio<b className="num mt-1 block text-foreground">{order.averagePrice ? fmtP(order.averagePrice) : "—"}</b></span><span className="text-muted-foreground">Taxa cobrada<b className="num mt-1 block text-foreground">{order.fee} {order.feeCurrency}</b></span></div>{order.error && <p className="mt-3 rounded-lg border border-sell/30 bg-sell/10 p-3 text-xs leading-relaxed text-sell">{order.error}</p>}</> : <p className="text-xs text-muted-foreground">O ID, status de execução, preço médio, taxa e eventual recusa da Gate.io aparecerão aqui.</p>}
  </Card>;
}

function Trades({ trades }: { trades: ReturnType<typeof useTradingEngine>["trades"] }) {
  const fmtReason = (reasons: { text: string; pts: number; max: number }[]) => reasons.length ? reasons.map((r) => `${r.text} (${r.pts}/${r.max})`).join(" • ") : "—";
  return <Card title="Histórico de Operações" icon={<History className="h-4 w-4 text-primary" />}><div className="max-h-72 overflow-auto"><table className="w-full min-w-[980px] text-xs"><thead className="text-left text-[10px] uppercase text-muted-foreground"><tr>{["Horário", "Par", "Motivo da Entrada (indicadores IA Jev)", "Entrada / Saída", "Taxas", "PnL Bruto", "PnL Líquido ($)", "Status"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr></thead><tbody>{trades.length === 0 && <tr><td colSpan={8} className="px-2 py-5 text-center text-muted-foreground">Nenhuma operação registrada ainda.</td></tr>}{trades.map((trade) => { const blocked = trade.status !== "Executada"; return <tr key={trade.id} className="border-t border-border align-top"><td className="px-2 py-2 num whitespace-nowrap">{new Date(trade.time).toLocaleTimeString("pt-BR")}</td><td className="px-2 py-2 font-semibold whitespace-nowrap">{trade.pair}<div className="text-[9px] font-normal text-muted-foreground">{trade.mode}</div></td><td className="px-2 py-2 min-w-[260px] text-[11px] text-muted-foreground">{fmtReason(trade.reasons)}{trade.reason ? <div className="mt-1 text-[10px] text-foreground/80">{trade.reason}</div> : null}</td><td className="px-2 py-2 num whitespace-nowrap">{trade.entry != null ? fmtP(trade.entry) : "—"}{trade.exit != null ? <div className="text-muted-foreground">→ {fmtP(trade.exit)}</div> : null}</td><td className="px-2 py-2 num whitespace-nowrap">{trade.fee != null ? `${trade.fee.toFixed(4)} USDT` : "—"}{trade.entryFee != null || trade.exitFee != null ? <div className="text-[9px] text-muted-foreground">in { (trade.entryFee ?? 0).toFixed(4)} / out {(trade.exitFee ?? 0).toFixed(4)}</div> : null}</td><td className={`px-2 py-2 num whitespace-nowrap ${trade.gross != null ? trade.gross >= 0 ? "text-buy" : "text-sell" : "text-muted-foreground"}`}>{trade.gross != null ? `${trade.gross >= 0 ? "+" : ""}${trade.gross.toFixed(4)} USDT` : "—"}</td><td className={`px-2 py-2 num whitespace-nowrap font-bold ${trade.pnl != null ? trade.pnl >= 0 ? "text-buy" : "text-sell" : "text-muted-foreground"}`}>{trade.pnl != null ? `${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(4)} USDT` : "—"}</td><td className="px-2 py-2"><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${blocked ? "bg-sell/15 text-sell" : "bg-buy/15 text-buy"}`}>{trade.status}</span></td></tr>; })}</tbody></table></div></Card>;
}



function PerformanceCard({ metrics }: { metrics: ReturnType<typeof useTradingEngine>["metrics"] }) {
  const pf = metrics.profitFactor == null ? "—" : metrics.profitFactor === Infinity ? "∞" : metrics.profitFactor.toFixed(2);
  const wr = metrics.winRate == null ? "—" : `${metrics.winRate.toFixed(1)}%`;
  const dd = metrics.drawdown == null ? "—" : `${metrics.drawdown.toFixed(2)}%`;
  return <Card title="Métricas de Performance" icon={<Activity className="h-4 w-4 text-primary" />}>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
      <div className="rounded-lg bg-muted p-3"><div className="text-muted-foreground">Win Rate</div><div className="num mt-1 text-lg font-bold text-buy">{wr}</div></div>
      <div className="rounded-lg bg-muted p-3"><div className="text-muted-foreground">Total de Taxas Pagas</div><div className="num mt-1 text-lg font-bold text-primary">{metrics.fees.toFixed(4)} USDT</div></div>
      <div className="rounded-lg bg-muted p-3"><div className="text-muted-foreground">Profit Factor</div><div className="num mt-1 text-lg font-bold">{pf}</div></div>
      <div className="rounded-lg bg-muted p-3"><div className="text-muted-foreground">Drawdown Máximo</div><div className="num mt-1 text-lg font-bold text-sell">{dd}</div></div>
    </div>
  </Card>;
}
function LogTerminal({ logs }: { logs: ReturnType<typeof useTradingEngine>["logs"] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [logs]);
  const tone = { scan: "text-muted-foreground", filter: "text-primary", buy: "text-buy", sell: "text-sell", warn: "text-sell", info: "text-foreground" } as const;
  return <Card title="Terminal da IA Jev & Gate.io" icon={<Terminal className="h-4 w-4 text-primary" />} right={<span className="flex items-center gap-1 text-[9px] text-buy"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-buy" />AO VIVO</span>}><div ref={ref} className="h-64 overflow-y-auto rounded-lg bg-terminal p-3 font-mono text-[10px] leading-relaxed sm:text-[11px]">{logs.map((item, index) => <div key={`${item.t}-${index}`} className={tone[item.kind]}><span className="text-muted-foreground">{new Date(item.t).toLocaleTimeString("pt-BR")} </span>{item.msg}</div>)}</div></Card>;
}
