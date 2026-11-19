import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Settings2, ShieldAlert, X } from "lucide-react";
import type { Settings } from "@/hooks/useTradingEngine";
import type { GateBalanceResult, GateCredentials } from "@/lib/gateio";

type Props = {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onTest: (credentials: GateCredentials) => Promise<GateBalanceResult>;
  realBalance: number;
};

const inputClass = "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";

function NumberField({ label, value, suffix, step = 0.1, min = 0, max = 100, onChange }: { label: string; value: number; suffix: string; step?: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs">
      <span className="mb-1.5 block text-muted-foreground">{label}</span>
      <span className="relative block">
        <input className={`${inputClass} num pr-10`} type="number" value={value} step={step} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="pointer-events-none absolute right-3 top-2 text-xs text-muted-foreground">{suffix}</span>
      </span>
    </label>
  );
}

function WeightSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block rounded-lg border border-border bg-muted/50 p-3">
      <span className="mb-2 flex items-center justify-between text-xs"><span>{label}</span><b className="num text-primary">{value}</b></span>
      <input type="range" min={0} max={100} step={5} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-[var(--primary)]" />
    </label>
  );
}

export function SettingsModal({ open, onClose, settings, onSettings, onTest, realBalance }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<GateBalanceResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);

  if (!open) return null;
  const test = async () => {
    setTesting(true);
    setResult(null);
    const response = await onTest({ apiKey, apiSecret });
    setResult(response);
    setTesting(false);
  };
  const selectReal = () => {
    if (!result?.ok) { setResult({ ok: false, error: "Primeiro teste a conexão e valide o saldo real." }); return; }
    if (window.confirm("ATENÇÃO: a IA Jev poderá enviar ordens reais à sua conta Gate.io. Deseja ativar o Modo Real?")) onSettings({ real: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="settings-title" className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground"><Settings2 className="h-5 w-5" /></span>
          <div className="flex-1"><h2 id="settings-title" className="font-bold">Configurações & IA Jev</h2><p className="text-xs text-muted-foreground">Alterações de estratégia salvas automaticamente neste navegador.</p></div>
          <button onClick={onClose} aria-label="Fechar configurações" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-6 p-5">
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-primary" />Credenciais da Gate.io</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">API Key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setResult(null); }} className={`${inputClass} mt-1.5 font-mono`} placeholder="Sua API Key" /></label>
              <label className="text-xs text-muted-foreground">Secret Key<span className="relative mt-1.5 block"><input type={visible ? "text" : "password"} autoComplete="new-password" value={apiSecret} onChange={(event) => { setApiSecret(event.target.value); setResult(null); }} className={`${inputClass} pr-11 font-mono`} placeholder="Sua Secret Key" /><button type="button" aria-label={visible ? "Ocultar Secret Key" : "Exibir Secret Key"} onClick={() => setVisible((value) => !value)} className="absolute right-1 top-1 rounded p-2 text-muted-foreground hover:text-foreground">{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button disabled={testing || !apiKey || !apiSecret} onClick={test} className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-40">{testing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Testar Conexão & Ver Saldo Real USDT</button>
              {result && <p className={`text-xs ${result.ok ? "text-buy" : "text-sell"}`}>{result.ok ? `Conectado · ${result.available.toFixed(4)} USDT disponíveis · ${result.locked.toFixed(4)} em ordens` : result.error}</p>}
            </div>
            <p className="mt-3 flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />As chaves são enviadas apenas ao servidor para assinar suas chamadas e nunca entram no localStorage ou nos logs. Sem a sincronização na nuvem, elas precisam ser informadas novamente ao recarregar.</p>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold">Modo de operação</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <button onClick={() => onSettings({ real: false })} className={`rounded-lg border p-3 text-left ${!settings.real ? "border-primary bg-primary/10" : "border-border bg-muted/50"}`}><span className="block text-sm font-bold">Modo Simulação</span><span className="text-xs text-muted-foreground">Paper Trading · sem enviar ordens</span></button>
              <button onClick={selectReal} className={`rounded-lg border p-3 text-left ${settings.real ? "border-sell bg-sell/10" : "border-border bg-muted/50"}`}><span className="flex items-center gap-2 text-sm font-bold"><ShieldAlert className="h-4 w-4 text-sell" />Modo Real</span><span className="text-xs text-muted-foreground">Dinheiro real na Gate.io</span></button>
            </div>
            {settings.real && <p className="mt-2 text-xs font-semibold text-sell">AUTO-TRADE REAL SELECIONADO · saldo conhecido: {realBalance.toFixed(4)} USDT</p>}
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" />Ajuste fino da IA Jev</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="rounded-lg border border-border bg-muted/50 p-3 text-xs"><span className="mb-2 flex justify-between"><span>Limiar de Certeza da IA Jev</span><b className="num text-primary">{settings.trigger}%</b></span><input type="range" min={50} max={99} value={settings.trigger} onChange={(event) => onSettings({ trigger: Number(event.target.value) })} className="w-full accent-[var(--primary)]" /></label>
              <label className="text-xs text-muted-foreground">Tempo entre Análises<select value={settings.intervalSeconds} onChange={(event) => onSettings({ intervalSeconds: Number(event.target.value) })} className={`${inputClass} mt-2`}>{[3, 5, 10, 30, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} segundos</option>)}</select></label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <WeightSlider label="Aceleração de Volume" value={settings.weights.volume} onChange={(volume) => onSettings({ weights: { ...settings.weights, volume } })} />
              <WeightSlider label="RSI / Sobrevenda" value={settings.weights.rsi} onChange={(rsi) => onSettings({ weights: { ...settings.weights, rsi } })} />
              <WeightSlider label="Rompimento de Preço" value={settings.weights.breakout} onChange={(breakout) => onSettings({ weights: { ...settings.weights, breakout } })} />
              <WeightSlider label="Fluxo do Livro de Ofertas" value={settings.weights.book} onChange={(book) => onSettings({ weights: { ...settings.weights, book } })} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold">Gestão de Risco & Banca</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <NumberField label="Capital por operação" value={Math.round(settings.allocation * 100)} suffix="%" step={1} min={1} onChange={(value) => onSettings({ allocation: Math.max(1, Math.min(100, value)) / 100 })} />
              <NumberField label="Take Profit" value={settings.tp} suffix="%" min={0.1} onChange={(tp) => onSettings({ tp })} />
              <NumberField label="Stop Loss" value={settings.sl} suffix="%" min={0.1} onChange={(sl) => onSettings({ sl })} />
              <NumberField label="Ativação do Trailing" value={settings.trailTrigger} suffix="%" min={0.1} onChange={(trailTrigger) => onSettings({ trailTrigger })} />
              <NumberField label="Distância do Trailing" value={settings.trailDistance} suffix="%" min={0.1} onChange={(trailDistance) => onSettings({ trailDistance })} />
              <NumberField label="Meta diária" value={settings.dailyGoalPct} suffix="%" min={1} onChange={(dailyGoalPct) => onSettings({ dailyGoalPct })} />
            </div>
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={settings.autoPause} onChange={(event) => onSettings({ autoPause: event.target.checked })} className="accent-[var(--buy)]" />Pausar automaticamente ao atingir a meta diária</label>
            <p className="mt-2 text-xs text-muted-foreground">Circuit breaker fixo de proteção: -{settings.dailyStopPct}% no dia. Uma operação por vez e cooldown obrigatório de 60 segundos.</p>
          </section>
        </div>
        <footer className="sticky bottom-0 border-t border-border bg-card/95 px-5 py-3 backdrop-blur"><button onClick={onClose} className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground">Salvar e voltar ao painel</button></footer>
      </section>
    </div>
  );
}
