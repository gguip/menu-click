// apps/menu/src/lib/tracker.ts
import { isFinished, type TrackedOrder } from "./tracking.ts";

/** O que o transporte usa de um WebSocket — o suficiente para o teste trocar. */
export type SocketLike = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
};

export const POLL_MS = 20_000;
export const RETRY_SOCKET_MS = 60_000;

export type TrackerState = {
  order: TrackedOrder | null;
  mode: "live" | "polling";
  updatedAt: number | null;
  notFound: boolean;
};

export type TrackerDeps = {
  fetchOrder: () => Promise<TrackedOrder | "not-found">;
  openSocket: () => SocketLike;
  now: () => number;
};

/**
 * WebSocket quando dá, consulta quando não. Toda mensagem do socket só avisa
 * que algo mudou: o pedido é sempre lido pelo `GET` (uma fonte para horários,
 * previsão e motivo). Socket que cai → consulta a cada 20 s e nova tentativa
 * de socket a cada minuto. Pedido terminado ou inexistente → para tudo.
 */
export function startTracker(deps: TrackerDeps, onChange: (state: TrackerState) => void) {
  let state: TrackerState = { order: null, mode: "polling", updatedAt: null, notFound: false };
  let socket: SocketLike | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const emit = (patch: Partial<TrackerState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  const stopPolling = () => {
    if (poll !== null) clearInterval(poll);
    poll = null;
  };

  const stop = () => {
    stopped = true;
    stopPolling();
    if (retry !== null) clearTimeout(retry);
    retry = null;
    const open = socket;
    socket = null;
    open?.close();
  };

  const refresh = () => {
    if (stopped) return;
    deps.fetchOrder().then(
      (result) => {
        if (stopped) return;
        if (result === "not-found") {
          emit({ notFound: true });
          stop();
          return;
        }
        emit({ order: result, updatedAt: deps.now() });
        if (isFinished(result.status)) stop();
      },
      () => {
        // sem rede: fica o último estado, e a próxima consulta tenta de novo
      },
    );
  };

  const fallBack = () => {
    if (stopped) return;
    socket = null;
    emit({ mode: "polling" });
    if (poll === null) poll = setInterval(refresh, POLL_MS);
    if (retry === null) {
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, RETRY_SOCKET_MS);
    }
  };

  const connect = () => {
    if (stopped) return;
    const s = deps.openSocket();
    socket = s;
    s.onopen = () => {
      if (stopped) return;
      stopPolling();
      emit({ mode: "live" });
    };
    s.onmessage = () => refresh();
    s.onclose = () => {
      if (socket === s) fallBack();
    };
    s.onerror = () => {
      if (socket === s) fallBack();
    };
  };

  refresh();
  connect();
  return { stop, refresh };
}
