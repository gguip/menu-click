let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  context ??= new AudioContext();
  return context;
}

async function ensureRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === "running") return true;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  // relido depois do await: o TS manteria o estreitamento de antes
  return (ctx.state as AudioContextState) === "running";
}

/** O navegador só libera áudio depois de um gesto do usuário na página. */
export function hasUserGesture(): boolean {
  // tipado à parte: nem toda versão do lib.dom do TypeScript declara userActivation
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation;
  return activation?.hasBeenActive ?? false;
}

/** Chamar DENTRO de um clique: é o gesto que destrava o áudio. */
export async function unlockAudio(): Promise<boolean> {
  const ctx = audioContext();
  return ctx === null ? false : ensureRunning(ctx);
}

/** Bipe curto (880 Hz, 250 ms), gerado na hora — sem arquivo de som. */
export async function playBeep(): Promise<boolean> {
  const ctx = audioContext();
  if (ctx === null || !(await ensureRunning(ctx))) return false;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.2;
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.25);
  return true;
}
