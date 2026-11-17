import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Activity, Bot, Crosshair, Flame, KeyRound, Play, Radar, RotateCcw, ShieldAlert, ShieldCheck, Square, Terminal, Wifi, WifiOff, History } from "lucide-react";
import { useTradingEngine, fmtP } from "@/hooks/useTradingEngine";
import { Card, CandleChart, Gauge, Reasons } from "@/components/bot/Widgets";
import { CEX_RISK, DEX_RISK, DAILY_GOAL_PCT } from "@/lib/indicators";
import { realKeysStatus } from "@/lib/binance.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Momentum Scalping Bot — Dashboard Cripto Spot" },
      { name: "description", content: "Robô de scalping com score de confiança ao vivo, radar de memecoins DEX/CEX e filtro anti-rug." },
      { property: "og:title", content: "Momentum Scalping Bot" },
      { property: "og:description", content: "Scalping cripto com dados ao vivo da Binance e DexScreener." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Dashboard() {
  const e = useTradingEngine();
  const goal = e.dayStart * DAILY_GOAL_PCT;
  const progress = Math.max(0, Math.min(100, (e.dayPnl / goal) * 100));
  const statusTone = e.status.startsWith("STOP") ? "bg-sell/15 text-sell border-sell/40" : e.status === "POSICIONADO" ? "bg-buy/15 text-buy border-buy/40" : e.status.startsWith("AGUARD") ? "bg-primary/15 text-primary border-primary/40" : "bg-muted text-muted-foreground border-border";
  const risk = e.settings.mode === "DEX" ? DEX_RISK : CEX_RISK;
  const cur = e.selected && e.position && e.selected.id === e.position.id ? e.selected.price : 0;
  const openPnl = e.position && cur ? (cur / e.position.entry - 1) * 100 : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground"><Bot className="h-5 w-5" /></div>
            <div>
              <h1 className="text-base font-bold leading-tight">Momentum & Scalping Bot</h1>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {e.connected ? <Wifi className="h-3 w-3 text-buy" /> : <WifiOff className="h-3 w-3 text-sell" />}
                Binance WS · USDT/BRL <span className="num">{e.usdBrl.toFixed(3)}</span>
                <span className={`rounded px-1.5 font-semibold ${e.settings.real ? "bg-sell text-destructive-foreground" : "bg-muted"}`}>{e.settings.real ? "REAL" : "PAPER"}</span>
              </div>
            </div>
          </div>
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold tracking-wider ${statusTone}`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{e.status}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-5">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Banca atual</div>
              <div className="num text-lg font-bold">{brl(e.balance)}</div>
              <div className="num text-[10px] text-muted-foreground">≈ {(e.balance / e.usdBrl).toFixed(2)} USDT</div>
            </div>
            <div className="w-56">
              <div className="flex justify-between text-[10px] uppercase text-muted-foreground"><span>Meta diária</span><span className={`num ${e.dayPnl >= 0 ? "text-buy" : "text-sell"}`}>{e.dayPnl >= 0 ? "+" : ""}{brl(e.dayPnl)} / +{brl(goal)}</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-buy transition-all" style={{ width: `${progress}%` }} /></div>
              <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
                <input type="checkbox" className="accent-[var(--buy)]" checked={e.settings.autoPause} onChange={(x) => e.updateSettings({ autoPause: x.target.checked })} />
                Pausar robô ao atingir a meta
              </label>
            </div>
            {e.running ? (
              <button onClick={e.stop} className="flex items-center gap-2 rounded-md bg-sell px-5 py-2.5 text-sm font-bold text-destructive-foreground"><Square className="h-4 w-4" />Parar Robô</button>
            ) : (
              <button onClick={e.start} className="glow-buy flex items-center gap-2 rounded-md bg-buy px-5 py-2.5 text-sm font-bold text-primary-foreground"><Play className="h-4 w-4" />Iniciar Robô</button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-4 p-4 xl:grid-cols-[300px_1fr_340px]">
        <div className="space-y-4">
          <Card title="Configuração" icon={<Crosshair className="h-4 w-4 text-primary" />}>
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                {(["CEX", "DEX"] as const).map((m) => (
                  <button key={m} onClick={() => e.updateSettings({ mode: m, lock: "AUTO" })} className={`rounded px-2 py-1.5 font-semibold ${e.settings.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{m === "CEX" ? "CEX Binance" : "Híbrido DEX"}</button>
                ))}
              </div>
              <div>
                <div className="mb-1 flex justify-between"><span>Gatilho de confiança</span><span className="num font-bold text-primary">{e.settings.trigger}%</span></div>
                <input type="range" min={50} max={100} value={e.settings.trigger} onChange={(x) => e.updateSettings({ trigger: +x.target.value })} className="w-full accent-[var(--primary)]" />
              </div>
              <div className="grid grid-cols-2 gap-2 num text-[11px]">
                <div className="rounded bg-muted p-2">TP <b className="text-buy">+{risk.tp}%</b></div>
                <div className="rounded bg-muted p-2">SL <b className="text-sell">-{risk.sl}%</b></div>
                <div className="col-span-2 rounded bg-muted p-2">Trailing: em +{risk.trailTrigger}% → stop +{risk.trailLock}%</div>
                <div className="col-span-2 rounded bg-muted p-2">Stop diário: <b className="text-sell">-{brl(e.dayStart * 0.1)}</b> · 98% da banca</div>
              </div>
              <button onClick={() => confirm("Reiniciar banca simulada para R$ 100,00?") && e.reset()} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><RotateCcw className="h-3 w-3" />Reiniciar simulação</button>
            </div>
          </Card>

          <Card title="Scanner" icon={<Activity className="h-4 w-4 text-primary" />} right={<button onClick={() => e.updateSettings({ lock: "AUTO" })} className={`rounded px-2 py-0.5 text-[10px] font-bold ${e.settings.lock === "AUTO" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>AUTO-CAÇADOR</button>}>
            <ul className="-mx-2 space-y-0.5">
              {e.candidates.filter((c) => c.source === "CEX").map((c) => (
                <li key={c.id}>
                  <button onClick={() => e.updateSettings({ lock: e.settings.lock === c.id ? "AUTO" : c.id })} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent ${e.settings.lock === c.id ? "bg-accent ring-1 ring-primary" : ""}`}>
                    <span className="flex-1 text-left font-semibold">{c.label.replace("USDT", "")}</span>
                    <span className={`num w-14 text-right ${c.change >= 0 ? "text-buy" : "text-sell"}`}>{c.change.toFixed(1)}%</span>
                    <span className="h-1.5 w-12 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary" style={{ width: `${c.score}%` }} /></span>
                    <span className={`num w-8 text-right font-bold ${c.score >= e.settings.trigger ? "text-buy" : ""}`}>{c.score}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <RealMode real={e.settings.real} onToggle={(v) => e.updateSettings({ real: v })} />
        </div>

        <div className="space-y-4 min-w-0">
          <Card title={e.selected ? `${e.selected.label} · ${e.selected.source === "CEX" ? "1m" : "amostras 3–15s"}` : "Gráfico"} icon={<Flame className="h-4 w-4 text-primary" />}
            right={e.selected && <span className="num text-sm font-bold">{fmtP(e.selected.price)}</span>}>
            <CandleChart klines={e.klines} position={e.position && e.selected?.id === e.position.id ? e.position : null} />
            {e.position && (
              <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md bg-muted px-3 py-2 text-xs num">
                <span>Posição: <b>{e.position.label}</b></span><span>Entrada {fmtP(e.position.entry)}</span><span>Valor {brl(e.position.sizeBrl)}</span>
                <span className={openPnl >= 0 ? "text-buy" : "text-sell"}>{openPnl.toFixed(2)}% ({brl(e.position.sizeBrl * openPnl / 100)})</span>
                <button onClick={e.closeNow} className="ml-auto rounded bg-sell px-2 py-1 font-sans font-bold text-destructive-foreground">Vender agora</button>
              </div>
            )}
          </Card>
          <Trades trades={e.trades} />
          <LogTerminal logs={e.logs} />
        </div>

        <div className="space-y-4">
          <Card title="Confiança da IA" icon={<Bot className="h-4 w-4 text-primary" />} right={<span className="text-[10px] text-muted-foreground">{e.selected?.label}</span>}>
            <Gauge score={e.selected?.score ?? 0} trigger={e.settings.trigger} />
            <div className="mt-2"><Reasons reasons={e.selected?.reasons ?? []} /></div>
          </Card>
          {e.settings.mode === "DEX" ? <DexRadar e={e} /> : (
            <Card title="Radar Recém-Lançadas (DEX & CEX)" icon={<Radar className="h-4 w-4 text-primary" />}>
              <p className="text-xs text-muted-foreground">Ative o modo <b>Híbrido DEX</b> para monitorar memecoins recém-lançadas em Solana e Base com filtro anti-rug.</p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

function DexRadar({ e }: { e: ReturnType<typeof useTradingEngine> }) {
  const dex = e.candidates.filter((c) => c.source === "DEX");
  return (
    <Card title="Radar Recém-Lançadas (DEX & CEX)" icon={<Radar className="h-4 w-4 animate-pulse text-primary" />} right={<span className="num text-[10px] text-muted-foreground">{e.dexLastUpdate ? new Date(e.dexLastUpdate).toLocaleTimeString("pt-BR") : "..."} · 15s</span>}>
      <ul className="-mx-2 max-h-[560px] space-y-1 overflow-y-auto">
        {dex.length === 0 && <li className="px-2 text-xs text-muted-foreground">Buscando pares na DexScreener...</li>}
        {dex.map((c) => (
          <li key={c.id}>
            <button onClick={() => e.updateSettings({ lock: e.settings.lock === c.id ? "AUTO" : c.id })} className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${e.settings.lock === c.id ? "bg-accent ring-1 ring-primary" : ""} ${c.safe ? "" : "opacity-60"}`}>
              <div className="flex items-center gap-2">
                {c.safe ? <ShieldCheck className="h-3.5 w-3.5 text-buy" /> : <ShieldAlert className="h-3.5 w-3.5 text-sell" />}
                <span className="flex-1 truncate font-semibold">{c.label}</span>
                <span className={`num ${c.change >= 0 ? "text-buy" : "text-sell"}`}>{c.change.toFixed(1)}% 5m</span>
                <span className={`num w-8 text-right font-bold ${c.score >= e.settings.trigger ? "text-buy" : ""}`}>{c.score}</span>
              </div>
              <div className="num mt-0.5 pl-5 text-[10px] text-muted-foreground">{c.safe ? c.extra : `Reprovado: ${c.safeReason}`}</div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Trades({ trades }: { trades: ReturnType<typeof useTradingEngine>["trades"] }) {
  return (
    <Card title="Histórico de Operações" icon={<History className="h-4 w-4 text-primary" />}>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs num">
          <thead className="text-left text-[10px] uppercase text-muted-foreground"><tr>{["Hora", "Par", "Tipo", "Entrada", "Saída", "Score", "Taxa", "P/L líq."].map((h) => <th key={h} className="px-2 py-1 font-sans font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {trades.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center font-sans text-muted-foreground">Nenhuma operação ainda.</td></tr>}
            {trades.map((t) => (
              <tr key={t.time} className="border-t border-border">
                <td className="px-2 py-1.5">{new Date(t.time).toLocaleTimeString("pt-BR")}</td>
                <td className="px-2 font-sans font-semibold">{t.pair}</td>
                <td className="px-2 font-sans">{t.reason}</td>
                <td className="px-2">{fmtP(t.entry)}</td><td className="px-2">{fmtP(t.exit)}</td>
                <td className="px-2">{t.score}%</td><td className="px-2">{brl(t.fee)}</td>
                <td className={`px-2 font-bold ${t.pnl >= 0 ? "text-buy" : "text-sell"}`}>{brl(t.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LogTerminal({ logs }: { logs: ReturnType<typeof useTradingEngine>["logs"] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [logs]);
  const tone = { scan: "text-muted-foreground", filter: "text-primary", buy: "text-buy", sell: "text-sell", warn: "text-sell", info: "text-foreground" } as const;
  return (
    <Card title="Terminal de Logs" icon={<Terminal className="h-4 w-4 text-primary" />}>
      <div ref={ref} className="h-64 overflow-y-auto rounded bg-terminal p-3 font-mono text-[11px] leading-relaxed">
        {logs.map((l, i) => <div key={i} className={tone[l.kind]}><span className="text-muted-foreground">{new Date(l.t).toLocaleTimeString("pt-BR")} </span>{l.msg}</div>)}
      </div>
    </Card>
  );
}

function RealMode({ real, onToggle }: { real: boolean; onToggle: (v: boolean) => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => { realKeysStatus().then((r) => setConfigured(r.configured)).catch(() => setConfigured(false)); }, []);
  return (
    <Card title="Modo Real (Binance)" icon={<KeyRound className="h-4 w-4 text-primary" />}>
      <div className="space-y-2 text-xs">
        <p className="text-muted-foreground">As chaves ficam somente no servidor (segredos <code>BINANCE_API_KEY</code> e <code>BINANCE_API_SECRET</code>) e as ordens são assinadas com HMAC-SHA256. Nunca digite suas chaves no navegador.</p>
        <div className="flex items-center gap-2">Status: {configured === null ? "verificando..." : configured ? <span className="text-buy font-semibold">chaves configuradas</span> : <span className="text-sell font-semibold">não configuradas</span>}</div>
        <button disabled={!configured} onClick={() => { if (real) onToggle(false); else if (confirm("ATENÇÃO: ordens REAIS serão enviadas à Binance (somente modo CEX). Continuar?")) onToggle(true); }}
          className={`w-full rounded px-2 py-1.5 font-bold disabled:opacity-40 ${real ? "bg-sell text-destructive-foreground" : "bg-muted"}`}>
          {real ? "Desativar modo real" : "Ativar modo real"}
        </button>
      </div>
    </Card>
  );
}
