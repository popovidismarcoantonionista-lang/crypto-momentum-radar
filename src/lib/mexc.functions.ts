import { createServerFn } from "@tanstack/react-start";
import type {
  GateBalanceResult,
  GateCredentials,
  GateOrder,
  GateOrderResult,
  GateOrderStatus,
} from "@/lib/gateio";
import { toMexcSymbol } from "@/lib/mexc";

const HOST = "https://api.mexc.com";
const encoder = new TextEncoder();

type MexcError = { code?: number; msg?: string };

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & MexcError;
  if (!response.ok) throw new Error(body.msg ?? `MEXC respondeu HTTP ${response.status}`);
  return body;
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function validateCredentials(credentials: GateCredentials) {
  if (
    !credentials ||
    credentials.apiKey.trim().length < 8 ||
    credentials.apiSecret.trim().length < 8
  ) {
    throw new Error("Informe uma API Key e uma Secret Key válidas da MEXC.");
  }
  return { apiKey: credentials.apiKey.trim(), apiSecret: credentials.apiSecret.trim() };
}

function validSymbol(symbol: string) {
  if (!/^[A-Z0-9]{1,24}_USDT$/.test(symbol)) throw new Error("Par USDT inválido.");
  return symbol;
}

async function signedRequest<T>(
  credentials: GateCredentials,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const { apiKey, apiSecret } = validateCredentials(credentials);
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) query.set(k, String(v));
  query.set("timestamp", String(Date.now()));
  query.set("recvWindow", "5000");
  const signature = await hmacSha256(apiSecret, query.toString());
  query.set("signature", signature);
  const url = `${HOST}${path}?${query.toString()}`;
  const response = await fetch(url, {
    method,
    headers: { "X-MEXC-APIKEY": apiKey, "Content-Type": "application/json" },
  });
  return parseResponse<T>(response);
}

export const testMexcConnection = createServerFn({ method: "POST" })
  .inputValidator((data: { credentials: GateCredentials }) => data)
  .handler(async ({ data }): Promise<GateBalanceResult> => {
    try {
      const account = await signedRequest<{
        balances?: { asset: string; free: string; locked: string }[];
      }>(data.credentials, "GET", "/api/v3/account");
      const usdt = (account.balances ?? []).find((b) => b.asset === "USDT");
      return { ok: true, available: Number(usdt?.free ?? 0), locked: Number(usdt?.locked ?? 0) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao consultar o saldo na MEXC.",
      };
    }
  });

type RawMexcOrder = {
  symbol: string;
  orderId: string | number;
  status: string;
  side: string;
  price?: string;
  origQty?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
};

function normalizeOrder(raw: RawMexcOrder, symbol: string, side: "buy" | "sell"): GateOrder {
  const executedQty = Number(raw.executedQty ?? 0);
  const filledTotal = Number(raw.cummulativeQuoteQty ?? 0);
  const averagePrice = executedQty > 0 ? filledTotal / executedQty : Number(raw.price ?? 0);
  const statusMap: Record<string, GateOrderStatus> = {
    FILLED: "CLOSED / EXECUTADA",
    PARTIALLY_FILLED: "OPEN",
    NEW: "OPEN",
    CANCELED: "CANCELLED",
    CANCELLED: "CANCELLED",
    REJECTED: "ERRO",
    EXPIRED: "CANCELLED",
  };
  return {
    orderId: String(raw.orderId),
    symbol,
    side,
    status: statusMap[raw.status] ?? "OPEN",
    averagePrice,
    executedQty,
    filledTotal,
    fee: 0,
    feeCurrency: "USDT",
    updatedAt: Date.now(),
  };
}

export const placeMexcOrder = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      credentials: GateCredentials;
      symbol: string;
      side: "buy" | "sell";
      amount: number;
    }) => {
      validSymbol(data.symbol);
      if (data.side !== "buy" && data.side !== "sell") throw new Error("Lado da ordem inválido.");
      if (!Number.isFinite(data.amount) || data.amount <= 0 || data.amount > 1_000_000)
        throw new Error("Valor da ordem inválido.");
      validateCredentials(data.credentials);
      return data;
    },
  )
  .handler(async ({ data }): Promise<GateOrderResult> => {
    try {
      const symbol = toMexcSymbol(data.symbol);
      const params: Record<string, string | number> = {
        symbol,
        side: data.side.toUpperCase(),
        type: "MARKET",
      };
      if (data.side === "buy") {
        params["quoteOrderQty"] = data.amount.toFixed(2);
      } else {
        params["quantity"] = data.amount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
      }
      const raw = await signedRequest<RawMexcOrder>(
        data.credentials,
        "POST",
        "/api/v3/order",
        params,
      );
      return { ok: true, order: normalizeOrder(raw, data.symbol, data.side) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "A MEXC recusou a ordem.",
      };
    }
  });

export const getMexcOrder = createServerFn({ method: "POST" })
  .inputValidator((data: { credentials: GateCredentials; symbol: string; orderId: string }) => {
    validSymbol(data.symbol);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(data.orderId)) throw new Error("ID da ordem inválido.");
    validateCredentials(data.credentials);
    return data;
  })
  .handler(async ({ data }): Promise<GateOrderResult> => {
    try {
      const raw = await signedRequest<RawMexcOrder>(data.credentials, "GET", "/api/v3/order", {
        symbol: toMexcSymbol(data.symbol),
        orderId: data.orderId,
      });
      const side = raw.side?.toLowerCase() === "sell" ? "sell" : "buy";
      return { ok: true, order: normalizeOrder(raw, data.symbol, side) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao consultar a ordem.",
      };
    }
  });
