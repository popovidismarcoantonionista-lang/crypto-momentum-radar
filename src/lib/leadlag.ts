export type DexSample = { time: number; price: number; volume5m: number };
export type TokenIdentity = { chain: string; address: string };
export function leadLag(
  samples: DexSample[],
  gate: TokenIdentity | undefined,
  dex: TokenIdentity,
  gateChange1m: number,
  now: number,
) {
  const none = { bonus: 0, change: 0, volumeRatio: 0, age: 0 };
  if (!gate || gate.chain !== dex.chain || gate.address.toLowerCase() !== dex.address.toLowerCase())
    return none;
  const latest = samples.at(-1);
  if (!latest || latest.price <= 0 || now - latest.time > 20_000) return none;
  let prior: DexSample | undefined;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const s = samples[i]!;
    if (s.time <= latest.time - 60_000 && s.time >= latest.time - 75_000) {
      prior = s;
      break;
    }
    if (s.time < latest.time - 75_000) break;
  }
  if (!prior || prior.price <= 0 || prior.volume5m <= 0) return none;
  const change = (latest.price / prior.price - 1) * 100;
  const volumeRatio = latest.volume5m / prior.volume5m;
  const bonus = change > 1.5 + 1e-10 && volumeRatio >= 2 && gateChange1m < change / 2 ? 10 : 0;
  return { bonus, change, volumeRatio, age: now - latest.time };
}
