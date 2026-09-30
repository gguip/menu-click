// apps/menu/src/app/[slug]/pedido/[orderId]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackingView } from "@/components/TrackingView.tsx";
import { getMenuRestaurant } from "@/lib/api.ts";

// O token de acompanhamento é credencial (S27): esta página nunca vai para
// cache compartilhado nem para buscador. O servidor só busca a loja (nome,
// cor, endereço); o pedido é lido NO NAVEGADOR, com o token da querystring.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; orderId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await getMenuRestaurant(slug);
  return {
    title: restaurant ? `${restaurant.name} · Seu pedido` : "Seu pedido",
    robots: { index: false, follow: false },
  };
}

export default async function TrackingPage({ params }: Props) {
  const { slug, orderId } = await params;
  const restaurant = await getMenuRestaurant(slug);
  if (!restaurant) notFound();
  return <TrackingView restaurant={restaurant} orderId={orderId} />;
}
