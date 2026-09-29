import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TableResolver } from "@/components/TableResolver.tsx";
import { getMenu } from "@/lib/api.ts";

// ISR: o cardápio sai do cache e se refaz a cada 60 s. A mesa (?mesa=) é lida
// NO NAVEGADOR — ler a querystring aqui tornaria a página dinâmica e mataria o
// cache (e com ele a folga para a API acordar num plano gratuito).
export const revalidate = 60;

// Nenhuma loja é gerada no build: cada cardápio é renderizado no primeiro
// acesso e fica em cache (ISR). Sem esta função a rota dinâmica sai como
// "renderizada a cada requisição" e o `revalidate` acima não vale nada.
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const menu = await getMenu(slug);
  if (!menu) return { title: "Cardápio" };
  return {
    title: `${menu.restaurant.name} · Cardápio`,
    description: `${menu.restaurant.cuisineType} — peça pelo celular.`,
    openGraph: { title: menu.restaurant.name, images: menu.restaurant.coverUrl ? [menu.restaurant.coverUrl] : [] },
  };
}

export default async function MenuPage({ params }: Props) {
  const { slug } = await params;
  const menu = await getMenu(slug);
  if (!menu) notFound();
  return (
    <Suspense fallback={null}>
      <TableResolver menu={menu} />
    </Suspense>
  );
}
