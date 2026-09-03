import { withTransaction } from "../db/pool.ts";
import type {
  CreateProductInput,
  Product,
  ProductFilters,
  ProductWithOptionGroups,
  UpdateProductInput,
} from "../domain/product.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import { isUuid } from "../domain/uuid.ts";
import { NotFoundError } from "../errors.ts";
import * as optionGroupsRepository from "../repositories/option-groups.ts";
import * as productsRepository from "../repositories/products.ts";
import * as categoriesService from "./categories.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de produtos: **a regra de negócio**.
 *
 * Uma regra vive aqui e em nenhum outro lugar: produto só existe dentro de um
 * restaurante vivo — por isso toda operação começa checando o pai
 * (`restaurantsService.ensureExists`).
 *
 * Dar baixa em estoque NÃO é responsabilidade daqui. Quem debita é a
 * confirmação de pedido (`services/orders.ts`), o único caminho do sistema que
 * tira unidade de `products.stock`.
 *
 * Como o serviço de restaurantes, não conhece Fastify nem escreve SQL.
 */

/** Erro padrão de produto inexistente — mesma mensagem em toda a API. */
function productNotFound(id: string): NotFoundError {
  return new NotFoundError(`Produto com id "${id}" não encontrado`);
}

/**
 * Confere que a categoria informada é **deste** restaurante antes de gravá-la.
 *
 * Sem isso, o id de uma categoria alheia entraria no produto e ele apareceria
 * agrupado no cardápio de quem não o criou — a checagem é no banco, na mesma
 * transação lógica da escrita, nunca só no cliente (S23). Categoria de outro
 * dono responde 404, como todo recurso que não é da sessão (S19).
 *
 * `null` passa direto: é o pedido explícito de tirar o produto da seção.
 */
async function ensureCategoryBelongs(
  restaurantId: string,
  categoryId: string | null | undefined,
): Promise<void> {
  if (categoryId === undefined || categoryId === null) return;
  await categoriesService.ensureExists(restaurantId, categoryId);
}

/**
 * Anexa `optionGroupIds` a cada produto, numa consulta só (não uma por
 * produto): mesmo padrão do cardápio público (`services/menu.ts`), aqui
 * reaproveitado para o lado de gestão.
 */
async function withOptionGroupIds(
  restaurantId: string,
  products: Product[],
): Promise<ProductWithOptionGroups[]> {
  const gruposPorProduto = await optionGroupsRepository.findGroupsByProductIds(
    restaurantId,
    products.map((product) => product.id),
  );
  return products.map((product) => ({
    ...product,
    optionGroupIds: (gruposPorProduto.get(product.id) ?? []).map(
      (grupo) => grupo.id,
    ),
  }));
}

export async function create(
  restaurantId: string,
  input: CreateProductInput,
): Promise<Product> {
  await restaurantsService.ensureExists(restaurantId);
  await ensureCategoryBelongs(restaurantId, input.categoryId);
  return productsRepository.insert(restaurantId, input);
}

/**
 * Produtos de um restaurante. Restaurante sem produtos devolve página vazia.
 *
 * Os filtros vêm da querystring e valem também para o `total`: filtrar e
 * continuar reportando o total do cardápio inteiro faria a paginação mentir.
 *
 * Categoria inexistente NÃO é erro aqui, e sim uma página vazia — filtro é
 * recorte de listagem, não acesso a recurso. Um 404 obrigaria a tela a tratar
 * "seção recém-apagada" como falha em vez de "não sobrou nada".
 */
export async function listByRestaurant(
  restaurantId: string,
  pagination: Pagination,
  filters: ProductFilters = {},
): Promise<Page<ProductWithOptionGroups>> {
  await restaurantsService.ensureExists(restaurantId);
  const { rows, total } = await productsRepository.findByRestaurant(
    restaurantId,
    pagination,
    filters,
  );
  const data = await withOptionGroupIds(restaurantId, rows);
  return { data, ...pagination, total };
}

export async function getById(
  restaurantId: string,
  id: string,
): Promise<ProductWithOptionGroups> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw productNotFound(id);

  const product = await productsRepository.findById(restaurantId, id);
  if (product === null) throw productNotFound(id);

  const [comOpcoes] = await withOptionGroupIds(restaurantId, [product]);
  return comOpcoes;
}

export async function update(
  restaurantId: string,
  id: string,
  input: UpdateProductInput,
): Promise<Product> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw productNotFound(id);
  await ensureCategoryBelongs(restaurantId, input.categoryId);

  const product = await productsRepository.update(restaurantId, id, input);
  if (product === null) throw productNotFound(id);
  return product;
}

/**
 * Remove o produto e **os vínculos dele com grupos de opções**, na mesma
 * transação (D3).
 */
export async function remove(restaurantId: string, id: string): Promise<void> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw productNotFound(id);

  await withTransaction(async (client) => {
    const removed = await productsRepository.softDelete(
      restaurantId,
      id,
      client,
    );
    if (!removed) throw productNotFound(id);

    await optionGroupsRepository.softDeleteLinksByProducts([id], client);
  });
}

/**
 * Os produtos das categorias informadas, sem paginar.
 *
 * Não repete o `ensureExists` do restaurante: quem chama é o serviço do
 * cardápio, que já resolveu o restaurante pelo slug — refazer a checagem seria
 * uma consulta a mais por requisição para confirmar o que acabou de ser lido.
 */
export async function listByCategoryIds(
  restaurantId: string,
  categoryIds: string[],
): Promise<Product[]> {
  if (categoryIds.length === 0) return [];
  return productsRepository.findByCategoryIds(restaurantId, categoryIds);
}

/** Os produtos que não estão em seção nenhuma. Mesma observação de cima. */
export async function listUncategorized(
  restaurantId: string,
): Promise<Product[]> {
  return productsRepository.findUncategorized(restaurantId);
}
