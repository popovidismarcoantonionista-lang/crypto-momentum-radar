export type BridgeSignal = {
  id: string;
  source: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  score?: number;
  reason?: string;
  createdAt: number;
  consumed?: boolean;
};

export type BridgeConfig = {
  enabled: boolean;
  token: string;
  webhookOutUrl: string;
  webhookOutEnabled: boolean;
  pollSignalsEnabled: boolean;
};

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  enabled: false,
  token: "",
  webhookOutUrl: "",
  webhookOutEnabled: false,
  pollSignalsEnabled: false,
};
