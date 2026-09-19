import { useSyncExternalStore } from "react";

// Um relógio de 1 s para o app inteiro, em vez de um setInterval por cartão.
// Mora fora do React para que ler a hora não seja chamada impura durante o
// render (a regra de pureza do React Compiler acusaria um Date.now() ali).
const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  current = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === null) {
    current = Date.now();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return current;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
