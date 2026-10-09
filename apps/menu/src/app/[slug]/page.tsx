import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuApp } from "@/components/MenuApp.tsx";
import { getMenu } from "@/lib/api.ts";
import { imageUrl } from "@/lib/image.ts";

// ISR: o cardápio sai do cache e se refaz a cada 60 s. A mesa (?mesa=) é lida
// NO NAVEGADOR, depois de montar (`useTable`) — ler a querystring aqui tornaria
// a página dinâmica, e o hook do Next para lê-la manda tudo até o limite de
// suspensão mais próximo para o navegador: o HTML do cache sairia vazio.
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
    openGraph: {
      title: menu.restaurant.name,
      images: menu.restaurant.coverUrl ? [imageUrl(menu.restaurant.coverUrl, 1200)] : [],
    },
  };
}

export default async function MenuPage({ params }: Props) {
  const { slug } = await params;
  const menu = await getMenu(slug);
  if (!menu) notFound();
  return <MenuApp menu={menu} />;
}
