/** Não há home: sem slug não existe cardápio, e a tela orienta sem botão falso. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-2 px-4">
      <h1 className="text-[19px] font-semibold">Este link não existe mais</h1>
      <p className="text-[15px] text-ink-2">
        Confira o endereço com o restaurante ou escaneie o QR code da mesa outra vez.
      </p>
    </main>
  );
}
