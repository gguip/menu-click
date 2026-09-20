import { useCallback, useEffect, useState } from "react";

/** Contagem regressiva em segundos; `start(n)` recomeça de `n`. */
export function useCountdown(): { seconds: number; start: (seconds: number) => void } {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const start = useCallback((value: number) => {
    setSeconds(Math.max(0, Math.ceil(value)));
  }, []);

  return { seconds, start };
}
