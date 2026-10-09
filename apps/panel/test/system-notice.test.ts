import { describe, expect, it, vi } from "vitest";
import { noticePermission, requestNoticePermission, showSystemNotice } from "../src/lib/systemNotice.ts";

function stubNotification(permission: NotificationPermission, answer: NotificationPermission = permission) {
  const created: { title: string; instance: { onclick: (() => void) | null; close: () => void } }[] = [];
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = answer;
      return answer;
    });
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(title: string) {
      created.push({ title, instance: this });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  return { created, FakeNotification };
}

describe("aviso do sistema", () => {
  it("navegador sem suporte: 'unsupported', e mostrar não quebra", async () => {
    expect(noticePermission()).toBe("unsupported");
    expect(await requestNoticePermission()).toBe("unsupported");
    expect(showSystemNotice("Novo pedido #1")).toBe(false);
  });

  it("só mostra com permissão concedida", () => {
    const denied = stubNotification("default");
    expect(showSystemNotice("Novo pedido #1")).toBe(false);
    expect(denied.created).toHaveLength(0);

    const granted = stubNotification("granted");
    expect(showSystemNotice("Novo pedido #1")).toBe(true);
    expect(granted.created.map((entry) => entry.title)).toEqual(["Novo pedido #1"]);
  });

  it("pedir a permissão devolve a resposta da pessoa", async () => {
    const { FakeNotification } = stubNotification("default", "granted");
    expect(await requestNoticePermission()).toBe("granted");
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
  });

  it("clicar no aviso traz a janela, fecha o aviso e chama quem pediu", () => {
    const { created } = stubNotification("granted");
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const onClick = vi.fn();
    showSystemNotice("Novo pedido #1", onClick);
    created[0].instance.onclick?.();
    expect(focus).toHaveBeenCalledOnce();
    expect(created[0].instance.close).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("construtor que estoura (Android sem service worker) não derruba o painel", () => {
    class Throwing {
      static permission = "granted";
      constructor() {
        throw new TypeError("Illegal constructor");
      }
    }
    vi.stubGlobal("Notification", Throwing);
    expect(showSystemNotice("Novo pedido #1")).toBe(false);
  });
});
