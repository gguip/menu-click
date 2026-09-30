// apps/menu/test/tracker.test.ts
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { POLL_MS, RETRY_SOCKET_MS, type SocketLike, startTracker, type TrackerState } from "../src/lib/tracker.ts";
import type { TrackedOrder } from "../src/lib/tracking.ts";

function fakeSocket() {
  const socket: SocketLike & { closed: boolean } = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    closed: false,
    close() {
      this.closed = true;
    },
  };
  return socket;
}

const order = (status: TrackedOrder["status"]) => ({ id: "o1", status }) as TrackedOrder;

describe("transporte do acompanhamento", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type Fetch = () => Promise<TrackedOrder | "not-found">;
  function setup(fetchOrder: Mock<Fetch> = vi.fn<Fetch>(async () => order("preparing"))) {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const states: TrackerState[] = [];
    const openSocket = vi.fn(() => {
      const s = fakeSocket();
      sockets.push(s);
      return s;
    });
    const tracker = startTracker({ fetchOrder, openSocket, now: () => Date.now() }, (s) => states.push(s));
    return { fetchOrder, openSocket, sockets, states, tracker };
  }

  it("socket aberto é tempo real; cada mensagem busca o pedido de novo", async () => {
    const { fetchOrder, sockets, states } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].onopen?.();
    expect(states.at(-1)?.mode).toBe("live");
    sockets[0].onmessage?.({ data: "{}" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOrder).toHaveBeenCalledTimes(2);
  });

  it("socket caiu: consulta a cada 20 s e tenta o socket de novo a cada minuto", async () => {
    const { fetchOrder, openSocket, sockets, states } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].onclose?.();
    expect(states.at(-1)?.mode).toBe("polling");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchOrder).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_SOCKET_MS - POLL_MS);
    expect(openSocket).toHaveBeenCalledTimes(2);
    sockets[1].onopen?.();
    const calls = fetchOrder.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchOrder.mock.calls.length).toBe(calls);
  });

  // Review Focus 3: pedido terminado não fica reconectando nem consultando
  it("pedido terminado: fecha o socket e para tudo", async () => {
    const { fetchOrder, openSocket, sockets } = setup(vi.fn(async () => order("completed")));
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0].closed).toBe(true);
    sockets[0].onclose?.();
    await vi.advanceTimersByTimeAsync(RETRY_SOCKET_MS * 3);
    expect(fetchOrder).toHaveBeenCalledTimes(1);
    expect(openSocket).toHaveBeenCalledTimes(1);
  });

  it("404 é 'não encontrado', e para tudo", async () => {
    const { states, openSocket, sockets } = setup(vi.fn(async () => "not-found" as const));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.notFound).toBe(true);
    sockets[0].onclose?.();
    await vi.advanceTimersByTimeAsync(RETRY_SOCKET_MS * 2);
    expect(openSocket).toHaveBeenCalledTimes(1);
  });

  it("sem rede na consulta: fica o último estado", async () => {
    let fail = false;
    const { states } = setup(
      vi.fn(async () => {
        if (fail) throw new TypeError("Failed to fetch");
        return order("preparing");
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(states.at(-1)?.order?.status).toBe("preparing");
  });
});
