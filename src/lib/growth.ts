export type GrowthSettings = {
  stagedExit: boolean;
  target1Pct: number;
  runnerTrailPct: number;
  maxHoldMinutes: number;
  dexMinLiquidity: number;
};
export const GROWTH_DEFAULTS: GrowthSettings = {
  stagedExit: true,
  target1Pct: 100,
  runnerTrailPct: 12,
  maxHoldMinutes: 15,
  dexMinLiquidity: 10_000,
};
export function proportionalHand(cash: number, allocation: number) {
  return Number.isFinite(cash) &&
    cash > 0 &&
    Number.isFinite(allocation) &&
    allocation > 0 &&
    allocation <= 1
    ? cash * allocation
    : 0;
}
export function growthExit(
  position: { entry: number; sl: number; peak: number; openedAt: number; target1Done?: boolean },
  price: number,
  settings: GrowthSettings,
  now: number,
) {
  const peak = Math.max(position.peak, price);
  if (!(price > 0) || !Number.isFinite(price)) return { action: "hold" as const, peak, reason: "" };
  if (price <= position.sl) return { action: "close" as const, peak, reason: "Stop Loss" };
  if (position.target1Done)
    return {
      action:
        price <= peak * (1 - settings.runnerTrailPct / 100)
          ? ("close" as const)
          : ("hold" as const),
      peak,
      reason: "Trailing da posição restante",
    };
  if (price >= position.entry * (1 + settings.target1Pct / 100))
    return { action: "half" as const, peak, reason: "Alvo 1 · venda de 50%" };
  if (now - position.openedAt >= settings.maxHoldMinutes * 60_000)
    return { action: "close" as const, peak, reason: "Saída por tempo sem Alvo 1" };
  return { action: "hold" as const, peak, reason: "" };
}
export type RugReport = {
  token?: { freezeAuthority?: string | null };
  risks?: { name?: string; description?: string; level?: string }[];
};
export function onchainSafety(
  liquidity: number,
  volume5m: number,
  minLiquidity: number,
  report: RugReport | undefined,
) {
  if (!Number.isFinite(liquidity) || liquidity < minLiquidity)
    return { ok: false, reason: "Liquidez abaixo do mínimo" };
  if (!Number.isFinite(volume5m) || volume5m <= 1000)
    return { ok: false, reason: "Volume 5m deve superar US$1.000" };
  if (
    !report ||
    !report.token ||
    !("freezeAuthority" in report.token) ||
    !Array.isArray(report.risks)
  )
    return { ok: false, reason: "RugCheck indisponível ou incompleto" };
  if (report.token.freezeAuthority) return { ok: false, reason: "Freeze Authority ativa" };
  if (
    report.risks.some(
      (risk) =>
        /freeze authority|freezeable|freezable/i.test(risk.name ?? "") ||
        (/honeypot|cannot sell|unable to sell/i.test(
          `${risk.name ?? ""} ${risk.description ?? ""}`,
        ) &&
          /danger|critical/i.test(risk.level ?? "")),
    )
  )
    return { ok: false, reason: "Freeze Authority ou honeypot crítico" };
  return { ok: true, reason: "Checagem básica aprovada · não garante venda" };
}
