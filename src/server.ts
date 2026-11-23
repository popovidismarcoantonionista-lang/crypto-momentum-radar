import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type BridgeSignal = { id: string; source: string; symbol: string; action: "buy" | "sell" | "hold"; score?: number; reason?: string; createdAt: number; consumed?: boolean };

const bridgeSignals: BridgeSignal[] = [];
const BRIDGE_MAX = 200;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function readToken(request: Request, url: URL) {
  return request.headers.get("x-bridge-token") || url.searchParams.get("token") || "";
}

async function handleBridge(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/bridge")) return null;
  const token = process.env["JEV_BRIDGE_TOKEN"] || "";
  const provided = readToken(request, url);
  if (token && provided !== token) return json({ ok: false, error: "Unauthorized" }, 401);

  if (url.pathname === "/api/bridge/status") {
    return json({ ok: true, service: "ia-jev-bridge", time: Date.now(), pendingSignals: bridgeSignals.filter((s) => !s.consumed).length });
  }

  if (url.pathname === "/api/bridge/signals" && request.method === "GET") {
    const consume = url.searchParams.get("consume") === "1";
    const pending = bridgeSignals.filter((s) => !s.consumed).slice(-50);
    if (consume) for (const s of pending) s.consumed = true;
    return json({ ok: true, signals: pending });
  }

  if (url.pathname === "/api/bridge/signal" && request.method === "POST") {
    let body: any;
    try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
    const symbol = String(body?.symbol ?? "").toUpperCase().replace(/[^A-Z0-9_]/g, "");
    const action = body?.action;
    if (!symbol.endsWith("_USDT") || !["buy", "sell", "hold"].includes(action)) return json({ ok: false, error: "Invalid signal" }, 400);
    const score = Number.isFinite(Number(body?.score)) ? Number(body.score) : undefined;
    const reason = body?.reason ? String(body.reason).slice(0, 200) : undefined;
    const signal: BridgeSignal = {
      id: crypto.randomUUID(),
      source: String(body?.source ?? "external").slice(0, 50),
      symbol,
      action,
      createdAt: Date.now(),
      ...(score !== undefined ? { score } : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
    bridgeSignals.push(signal);
    while (bridgeSignals.length > BRIDGE_MAX) bridgeSignals.shift();
    return json({ ok: true, signal });
  }

  return json({ ok: false, error: "Not found" }, 404);
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const bridge = await handleBridge(request);
      if (bridge) return bridge;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
