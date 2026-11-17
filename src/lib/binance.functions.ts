import { createServerFn } from "@tanstack/react-start";

async function sign(secret: string, query: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(query));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const realKeysStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { configured: Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) };
});

type OrderInput = { symbol: string; side: "BUY" | "SELL"; quoteOrderQty?: number; quantity?: string };

export const placeRealOrder = createServerFn({ method: "POST" })
  .inputValidator((d: OrderInput) => {
    if (!/^[A-Z0-9]{5,20}$/.test(d.symbol)) throw new Error("Par inválido");
    if (d.side !== "BUY" && d.side !== "SELL") throw new Error("Lado inválido");
    if (d.side === "BUY" && !(d.quoteOrderQty && d.quoteOrderQty >= 5 && d.quoteOrderQty < 100000)) throw new Error("Valor inválido");
    if (d.side === "SELL" && !(d.quantity && /^[0-9.]+$/.test(d.quantity))) throw new Error("Quantidade inválida");
    return d;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET;
    if (!apiKey || !secret) return { ok: false as const, error: "Chaves da Binance não configuradas no backend." };
    const params = new URLSearchParams({ symbol: data.symbol, side: data.side, type: "MARKET", timestamp: String(Date.now()), recvWindow: "5000" });
    if (data.side === "BUY") params.set("quoteOrderQty", data.quoteOrderQty!.toFixed(2));
    else params.set("quantity", data.quantity!);
    const q = params.toString();
    const res = await fetch(`https://api.binance.com/api/v3/order?${q}&signature=${await sign(secret, q)}`, {
      method: "POST", headers: { "X-MBX-APIKEY": apiKey },
    });
    const json = (await res.json()) as { executedQty?: string; cummulativeQuoteQty?: string; msg?: string };
    if (!res.ok) return { ok: false as const, error: json.msg ?? `HTTP ${res.status}` };
    return { ok: true as const, executedQty: json.executedQty ?? "0", quote: json.cummulativeQuoteQty ?? "0" };
  });
