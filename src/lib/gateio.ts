import type { JevMarket } from "@/lib/jev";

export type GateCredentials = { apiKey: string; apiSecret: string };
export type GateMarketResponse = {
  markets: JevMarket[];
  usdBrl: number;
  fetchedAt: number;
  failed: number;
};
export type GateOrderStatus = "OPEN" | "CLOSED / EXECUTADA" | "CANCELLED" | "ERRO";
export type GateOrder = {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  status: GateOrderStatus;
  averagePrice: number;
  executedQty: number;
  filledTotal: number;
  fee: number;
  feeCurrency: string;
  error?: string;
  updatedAt: number;
};
export type GateOrderResult = { ok: true; order: GateOrder } | { ok: false; error: string };
export type GateBalanceResult =
  { ok: true; available: number; locked: number } | { ok: false; error: string };
export type GatePairRule = {
  minQuote: number;
  minBase: number;
  amountPrecision: number;
  pricePrecision: number;
  tradable: boolean;
};
export type GateBookSnapshot = {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  bookTime: number;
  rules?: GatePairRule & { fetchedAt: number };
};
