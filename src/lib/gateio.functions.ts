import { createServerFn } from "@tanstack/react-start";
import type { Kline, Level } from "@/lib/indicators";
import type { GateBalanceResult, GateCredentials, GateMarketResponse, GateOrder, GateOrderResult, GateOrderStatus } from "@/lib/gateio";

const HOST = "https://api.gateio.ws";
const PREFIX = "/api/v4";
const MEMES = ["PEPE", "DOGE", "SHIB", "WIF", "BONK", "FLOKI", "BOME", "MEW", "POPCAT", "TURBO", "NEIRO", "PNUT", "MOODENG", "GOAT", "ACT", "CHILLGUY"];
const encoder = new TextEncoder();

type Ticker = { currency_pair: string; last: string; change_percentage: string; quote_volume: string };
type GateError = { label?: string; message?: string };

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & GateError;
  if (!response.ok) throw new Error(body.message ?? body.label ?? `Gate.io respondeu HTTP ${response.status}`);
  return body;
}

async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(`${HOST}${PREFIX}${path}`, { headers: { Accept: "application/json" } });
  return parseResponse<T>(response);
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha512(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function validateCredentials(credentials: GateCredentials) {
  if (!credentials || credentials.apiKey.trim().length < 8 || credentials.apiSecret.trim().length < 8) {
    throw new Error("Informe uma API Key e uma Secret Key válidas da Gate.io.");
  }
  return { apiKey: credentials.apiKey.trim(), apiSecret: credentials.apiSecret.trim() };
}

async function signedRequest<T>(credentials: GateCredentials, method: "GET" | "POST", path: string, query = "", payload = ""): Promise<T> {
  const { apiKey, apiSecret } = validateCredentials(credentials);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payloadHash = hex(await crypto.subtle.digest("SHA-512", encoder.encode(payload)));
  const signature = await hmacSha512(apiSecret, `${method}\n${PREFIX}${path}\n${query}\n${payloadHash}\n${timestamp}`);
  const response = await fetch(`${HOST}${PREFIX}${path}${query ? `?${query}` : ""}`, {
    method,
    headers: { KEY: apiKey, Timestamp: timestamp, SIGN: signature, "Content-Type": "application/json", Accept: "application/json" },
    ...(method === "POST" ? { body: payload } : {}),
  });
  return parseResponse<T>(response);
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]!);
    }
  }));
  return results;
}

function parseKlines(rows: string[][]): Kline[] {
  return rows.map((row) => ({ t: Number(row[0]) * 1000, v: Number(row[1]), c: Number(row[2]), h: Number(row[3]), l: Number(row[4]), o: Number(row[5]) })).filter((k) => k.c > 0).sort((a, b) => a.t - b.t);
}

function validSymbol(symbol: string) {
  if (!/^[A-Z0-9]{1,24}_USDT$/.test(symbol)) throw new Error("Par USDT inválido.");
  return symbol;
}

export const getGateMarket = createServerFn({ method: "GET" }).handler(async (): Promise<GateMarketResponse> => {
  const [tickers, brlResult] = await Promise.all([
    publicGet<Ticker[]>("/spot/tickers"),
    fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL").then((r) => r.json()).then((r: { price?: string }) => Number(r.price) || 5.88).catch(() => 5.88),
  ]);
  const available = new Map(tickers.map((ticker) => [ticker.currency_pair, ticker]));
  const liquidUsdt = tickers.filter((ticker) => ticker.currency_pair.endsWith("_USDT") && Number(ticker.quote_volume) >= 100_000 && !/(3L|3S|5L|5S)_USDT$/.test(ticker.currency_pair));
  const memeSymbols = MEMES.map((base) => `${base}_USDT`).filter((symbol) => available.has(symbol)).sort((a, b) => Number(available.get(b)!.quote_volume) - Number(available.get(a)!.quote_volume));
  const movers = liquidUsdt.filter((ticker) => Number(ticker.change_percentage) >= 5).sort((a, b) => Number(b.change_percentage) - Number(a.change_percentage)).slice(0, 8).map((ticker) => ticker.currency_pair);
  const active = [...liquidUsdt].sort((a, b) => Math.abs(Number(b.change_percentage)) * Math.log10(Number(b.quote_volume) + 10) - Math.abs(Number(a.change_percentage)) * Math.log10(Number(a.quote_volume) + 10)).slice(0, 5).map((ticker) => ticker.currency_pair);
  const symbols = [...new Set(["PEARL_USDT", ...memeSymbols, ...movers, ...active])].filter((symbol) => available.has(symbol)).slice(0, 24);
  let failed = 0;
  const markets = await mapLimit(symbols, 6, async (symbol) => {
    try {
      const [klines, book] = await Promise.all([
        publicGet<string[][]>(`/spot/candlesticks?currency_pair=${symbol}&interval=1m&limit=45`),
        publicGet<{ bids: string[][]; asks: string[][] }>(`/spot/order_book?currency_pair=${symbol}&limit=10`),
      ]);
      const ticker = available.get(symbol)!;
      return {
        symbol,
        price: Number(ticker.last),
        change24: Number(ticker.change_percentage),
        quoteVolume: Number(ticker.quote_volume),
        klines: parseKlines(klines),
        bids: book.bids.map(([price, quantity]) => [Number(price), Number(quantity)] as Level),
        asks: book.asks.map(([price, quantity]) => [Number(price), Number(quantity)] as Level),
      };
    } catch {
      failed += 1;
      const ticker = available.get(symbol)!;
      return { symbol, price: Number(ticker.last), change24: Number(ticker.change_percentage), quoteVolume: Number(ticker.quote_volume), klines: [], bids: [], asks: [] };
    }
  });
  markets.sort((a, b) => a.symbol === "PEARL_USDT" ? -1 : b.symbol === "PEARL_USDT" ? 1 : b.quoteVolume - a.quoteVolume);
  return { markets, usdBrl: brlResult, fetchedAt: Date.now(), failed };
});

export const getGateTicker = createServerFn({ method: "GET" }).inputValidator((symbol: string) => validSymbol(symbol)).handler(async ({ data }) => {
  const rows = await publicGet<Ticker[]>(`/spot/tickers?currency_pair=${data}`);
  const ticker = rows[0];
  if (!ticker) throw new Error("Par não encontrado na Gate.io.");
  return { symbol: data, price: Number(ticker.last), change24: Number(ticker.change_percentage), quoteVolume: Number(ticker.quote_volume) };
});

export const testGateConnection = createServerFn({ method: "POST" }).inputValidator((data: { credentials: GateCredentials }) => data).handler(async ({ data }): Promise<GateBalanceResult> => {
  try {
    const accounts = await signedRequest<{ currency: string; available: string; locked: string }[]>(data.credentials, "GET", "/spot/accounts");
    const usdt = accounts.find((account) => account.currency === "USDT");
    return { ok: true, available: Number(usdt?.available ?? 0), locked: Number(usdt?.locked ?? 0) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falha ao consultar o saldo na Gate.io." };
  }
});

type RawOrder = { id: string; currency_pair: string; side: "buy" | "sell"; status: string; avg_deal_price?: string; filled_total?: string; amount?: string; left?: string; fee?: string; fee_currency?: string };
function normalizeOrder(raw: RawOrder): GateOrder {
  const averagePrice = Number(raw.avg_deal_price ?? 0);
  const filledTotal = Number(raw.filled_total ?? 0);
  const executedQty = averagePrice > 0 ? filledTotal / averagePrice : 0;
  const status: GateOrderStatus = raw.status === "closed" ? "CLOSED / EXECUTADA" : raw.status === "cancelled" ? "CANCELLED" : "OPEN";
  return { orderId: raw.id, symbol: raw.currency_pair, side: raw.side, status, averagePrice, executedQty, filledTotal, fee: Number(raw.fee ?? 0), feeCurrency: raw.fee_currency ?? "", updatedAt: Date.now() };
}

export const placeGateOrder = createServerFn({ method: "POST" }).inputValidator((data: { credentials: GateCredentials; symbol: string; side: "buy" | "sell"; amount: number }) => {
  validSymbol(data.symbol);
  if (data.side !== "buy" && data.side !== "sell") throw new Error("Lado da ordem inválido.");
  if (!Number.isFinite(data.amount) || data.amount <= 0 || data.amount > 1_000_000) throw new Error("Valor da ordem inválido.");
  validateCredentials(data.credentials);
  return data;
}).handler(async ({ data }): Promise<GateOrderResult> => {
  try {
    const amount = data.side === "buy" ? data.amount.toFixed(2) : data.amount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    const payload = JSON.stringify({ currency_pair: data.symbol, side: data.side, type: "market", amount });
    const raw = await signedRequest<RawOrder>(data.credentials, "POST", "/spot/orders", "", payload);
    return { ok: true, order: normalizeOrder(raw) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "A Gate.io recusou a ordem." };
  }
});

export const getGateOrder = createServerFn({ method: "POST" }).inputValidator((data: { credentials: GateCredentials; symbol: string; orderId: string }) => {
  validSymbol(data.symbol);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(data.orderId)) throw new Error("ID da ordem inválido.");
  validateCredentials(data.credentials);
  return data;
}).handler(async ({ data }): Promise<GateOrderResult> => {
  try {
    const query = new URLSearchParams({ currency_pair: data.symbol }).toString();
    const raw = await signedRequest<RawOrder>(data.credentials, "GET", `/spot/orders/${data.orderId}`, query);
    return { ok: true, order: normalizeOrder(raw) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falha ao consultar a ordem." };
  }
});
