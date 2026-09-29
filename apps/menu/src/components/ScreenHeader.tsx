import { BackIcon } from "./icons.tsx";

/** O cabeçalho das telas internas: voltar, título e o contexto à direita. */
export function ScreenHeader({
  title,
  context,
  onBack,
}: {
  title: string;
  context?: string;
  onBack: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-paper-3 bg-paper px-2 py-1.5">
      <button
        type="button"
        aria-label="Voltar"
        onClick={onBack}
        className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-paper-2"
      >
        <BackIcon size={18} />
      </button>
      <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h1>
      {context && <span className="ml-auto pr-2 text-xs text-ink-2">{context}</span>}
    </header>
  );
}
