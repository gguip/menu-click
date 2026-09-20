export function elapsedMinutes(fromIso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 60_000));
}

export function formatElapsed(fromIso: string, nowMs: number): string {
  const minutes = elapsedMinutes(fromIso, nowMs);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

/** Hora de parede ("20:10") no fuso da loja; sem fuso, no do navegador. */
export function formatClock(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatAge(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return whole === 1 ? "1 segundo" : `${whole} segundos`;
  const minutes = Math.floor(whole / 60);
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

export function formatSecondsAgo(fromMs: number, nowMs: number): string {
  return `há ${Math.max(0, Math.round((nowMs - fromMs) / 1000))} s`;
}
