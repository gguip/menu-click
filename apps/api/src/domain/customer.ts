/**
 * Modelo de cliente — só tipos, sem runtime. Ver `restaurant.ts`.
 *
 * Cliente aqui é um **contato**, não uma conta: não há senha, login nem sessão.
 * Quem escaneia o QR code na mesa informa nome e telefone, e o telefone é o que
 * identifica a pessoa entre um pedido e outro (índice único parcial no banco).
 */

/** O que o cliente informa ao fazer um pedido. */
export type CreateCustomerInput = {
  name: string;
  phone: string;
};

/** Cliente completo, como é guardado e devolvido dentro do pedido. */
export type Customer = CreateCustomerInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
