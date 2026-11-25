import type { GateBalanceResult, GateCredentials, GateOrder, GateOrderResult } from "@/lib/gateio";

export type MexcCredentials = GateCredentials;
export type MexcOrder = GateOrder;
export type MexcOrderResult = GateOrderResult;
export type MexcBalanceResult = GateBalanceResult;

export function toMexcSymbol(symbol: string) {
  return symbol.replace(/_/g, "");
}

export function fromMexcSymbol(symbol: string) {
  if (symbol.endsWith("USDT")) return `${symbol.slice(0, -4)}_USDT`;
  return symbol;
}
