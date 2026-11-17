import type { Kline, Reason } from "@/lib/indicators";
import { fmtP, type Position } from "@/hooks/useTradingEngine";
import { Check, X } from "lucide-react";

export function Card({ title, icon, right, children, className = "" }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-card ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide">{icon}{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Gauge({ score, trigger }: { score: number; trigger: number }) {
  const a = Math.PI * (1 - score / 100);
  const x = 100 + 80 * Math.cos(a), y = 100 - 80 * Math.sin(a);
  const ta = Math.PI * (1 - trigger / 100);
  const color = score >= trigger ? "var(--buy)" : score >= 60 ? "var(--primary)" : "var(--sell)";
  return (
    <svg viewBox="0 0 200 120" className="mx-auto w-full max-w-[260px]">
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--muted)" strokeWidth="14" strokeLinecap="round" />
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" pathLength={100} strokeDasharray={`${score} 100`} style={{ transition: "stroke-dasharray .6s ease, stroke .6s" }} />
      <line x1={100 + 64 * Math.cos(ta)} y1={100 - 64 * Math.sin(ta)} x2={100 + 96 * Math.cos(ta)} y2={100 - 96 * Math.sin(ta)} stroke="var(--foreground)" strokeWidth="2" strokeDasharray="3 2" />
      <line x1="100" y1="100" x2={x} y2={y} stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round" style={{ transition: "all .6s ease" }} />
      <circle cx="100" cy="100" r="6" fill="var(--foreground)" />
      <text x="100" y="82" textAnchor="middle" className="num" fontSize="26" fontWeight="700" fill={color}>{score}%</text>
    </svg>
  );
}

export function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="space-y-1.5 text-xs">
      {reasons.map((r) => (
        <li key={r.text} className="flex items-start gap-2">
          {r.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-buy" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sell" />}
          <span className="flex-1">{r.text}</span>
          <span className="num text-muted-foreground">{r.pts}/{r.max}</span>
        </li>
      ))}
    </ul>
  );
}

export function CandleChart({ klines, position }: { klines: Kline[]; position: Position | null }) {
  const W = 800, H = 300;
  if (klines.length < 2) return <div className="grid h-[300px] place-items-center text-sm text-muted-foreground">Carregando velas ao vivo...</div>;
  const levels = position ? [position.entry, position.tp, position.sl] : [];
  const hi = Math.max(...klines.map((k) => k.h), ...levels), lo = Math.min(...klines.map((k) => k.l), ...levels);
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  const Y = (p: number) => ((hi + pad - p) / (hi - lo + 2 * pad)) * H;
  const bw = W / klines.length;
  const line = (p: number, color: string, label: string) => (
    <g key={label}>
      <line x1="0" x2={W} y1={Y(p)} y2={Y(p)} stroke={color} strokeDasharray="6 4" strokeWidth="1.5" />
      <rect x={W - 150} y={Y(p) - 10} width="150" height="18" fill={color} rx="2" />
      <text x={W - 145} y={Y(p) + 3} fontSize="11" className="num" fill="var(--primary-foreground)">{label} {fmtP(p)}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[300px] w-full" preserveAspectRatio="none">
      {klines.map((k, i) => {
        const up = k.c >= k.o, col = up ? "var(--buy)" : "var(--sell)";
        return (
          <g key={i}>
            <line x1={i * bw + bw / 2} x2={i * bw + bw / 2} y1={Y(k.h)} y2={Y(k.l)} stroke={col} />
            <rect x={i * bw + bw * 0.15} width={bw * 0.7} y={Y(Math.max(k.o, k.c))} height={Math.max(1, Math.abs(Y(k.o) - Y(k.c)))} fill={col} />
          </g>
        );
      })}
      {position && [line(position.tp, "var(--buy)", "TP"), line(position.entry, "var(--primary)", "ENTRADA"), line(position.sl, "var(--sell)", position.trailed ? "TRAIL" : "SL")]}
    </svg>
  );
}
