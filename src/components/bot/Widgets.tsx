import type { Kline, Reason } from "@/lib/indicators";
import { fmtP, type Position } from "@/hooks/useTradingEngine";
import { Check, X } from "lucide-react";

export function Card({ title, icon, right, children, className = "" }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-card shadow-sm ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide">{icon}{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Gauge({ score, trigger }: { score: number; trigger: number }) {
  const angle = Math.PI * (1 - score / 100);
  const x = 100 + 80 * Math.cos(angle);
  const y = 100 - 80 * Math.sin(angle);
  const triggerAngle = Math.PI * (1 - trigger / 100);
  const color = score >= trigger ? "var(--buy)" : score >= 60 ? "var(--primary)" : "var(--sell)";
  return (
    <svg viewBox="0 0 200 120" className="mx-auto w-full max-w-[260px]" role="img" aria-label={`Certeza da IA Jev: ${score}%`}>
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--muted)" strokeWidth="14" strokeLinecap="round" />
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" pathLength={100} strokeDasharray={`${score} 100`} style={{ transition: "stroke-dasharray .6s ease, stroke .6s" }} />
      <line x1={100 + 64 * Math.cos(triggerAngle)} y1={100 - 64 * Math.sin(triggerAngle)} x2={100 + 96 * Math.cos(triggerAngle)} y2={100 - 96 * Math.sin(triggerAngle)} stroke="var(--foreground)" strokeWidth="2" strokeDasharray="3 2" />
      <line x1="100" y1="100" x2={x} y2={y} stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round" style={{ transition: "all .6s ease" }} />
      <circle cx="100" cy="100" r="6" fill="var(--foreground)" />
      <text x="100" y="82" textAnchor="middle" className="num" fontSize="26" fontWeight="700" fill={color}>{score}%</text>
      <text x="100" y="114" textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">LIMIAR {trigger}%</text>
    </svg>
  );
}

export function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="space-y-2 text-xs">
      {reasons.map((reason) => (
        <li key={reason.text} className="flex items-start gap-2 rounded-md bg-muted/50 p-2">
          {reason.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-buy" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sell" />}
          <span className="flex-1 leading-relaxed">{reason.text}</span>
          <span className="num text-muted-foreground">{reason.pts}/{reason.max}</span>
        </li>
      ))}
    </ul>
  );
}

export function CandleChart({ klines, position }: { klines: Kline[]; position: Position | null }) {
  const width = 800;
  const height = 300;
  if (klines.length < 2) return <div className="grid h-[300px] place-items-center rounded-lg bg-muted/30 text-sm text-muted-foreground">Carregando velas de 1 minuto da Gate.io...</div>;
  const levels = position ? [position.entry, position.tp, position.sl] : [];
  const high = Math.max(...klines.map((kline) => kline.h), ...levels);
  const low = Math.min(...klines.map((kline) => kline.l), ...levels);
  const padding = (high - low) * 0.08 || high * 0.01;
  const y = (price: number) => ((high + padding - price) / (high - low + 2 * padding)) * height;
  const candleWidth = width / klines.length;
  const line = (price: number, color: string, label: string) => (
    <g key={label}>
      <line x1="0" x2={width} y1={y(price)} y2={y(price)} stroke={color} strokeDasharray="6 4" strokeWidth="1.5" />
      <rect x={width - 160} y={y(price) - 10} width="160" height="18" fill={color} rx="2" />
      <text x={width - 155} y={y(price) + 3} fontSize="11" className="num" fill="var(--primary-foreground)">{label} {fmtP(price)}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] w-full rounded-lg bg-muted/20 sm:h-[300px]" preserveAspectRatio="none" role="img" aria-label="Gráfico de velas do par selecionado">
      {klines.map((kline, index) => {
        const up = kline.c >= kline.o;
        const color = up ? "var(--buy)" : "var(--sell)";
        return <g key={`${kline.t}-${index}`}><line x1={index * candleWidth + candleWidth / 2} x2={index * candleWidth + candleWidth / 2} y1={y(kline.h)} y2={y(kline.l)} stroke={color} /><rect x={index * candleWidth + candleWidth * 0.15} width={Math.max(1, candleWidth * 0.7)} y={y(Math.max(kline.o, kline.c))} height={Math.max(1, Math.abs(y(kline.o) - y(kline.c)))} fill={color} /></g>;
      })}
      {position && [line(position.tp, "var(--buy)", "TP"), line(position.entry, "var(--primary)", "ENTRADA"), line(position.sl, "var(--sell)", position.trailed ? "TRAILING" : "SL")]}
    </svg>
  );
}
