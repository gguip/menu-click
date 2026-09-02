import { describe, expect, it } from "vitest";
import {
  contribuicaoDoGrupo,
  dividirArredondando,
  precoUnitario,
} from "../src/domain/option.ts";

/**
 * A aritmética de dinheiro do cardápio.
 *
 * Não toca no banco de propósito: é a única parte do sistema em que um erro de
 * um centavo se propaga para todo pedido, e ela precisa ser verificável sem
 * subir nada.
 */
describe("aritmética de preço das opções", () => {
  describe("dividirArredondando", () => {
    it("arredonda meio para cima", () => {
      expect(dividirArredondando(5, 2)).toBe(3); // 2.5
      expect(dividirArredondando(7, 2)).toBe(4); // 3.5
      expect(dividirArredondando(9505, 2)).toBe(4753); // 4752.5
    });

    it("não arredonda o que já é inteiro", () => {
      expect(dividirArredondando(8180, 2)).toBe(4090);
      expect(dividirArredondando(0, 3)).toBe(0);
    });

    /**
     * A razão de a função existir em vez de `Math.round(n / d)`: remover a
     * classe inteira de dúvida sobre float, não porque ele erre nas nossas
     * magnitudes (foi medido que não), mas porque a equivalência depende da
     * faixa de valor e a aritmética inteira não.
     */
    it("concorda com a divisão exata em toda a faixa de um cardápio", () => {
      for (let d = 1; d <= 6; d++) {
        for (let n = 0; n <= 30000; n += 7) {
          const exato = Math.floor(n / d) + (2 * (n % d) >= d ? 1 : 0);
          expect(dividirArredondando(n, d)).toBe(exato);
        }
      }
    });
  });

  describe("contribuicaoDoGrupo", () => {
    it("sum soma preço vezes quantidade", () => {
      expect(
        contribuicaoDoGrupo("sum", [
          { priceInCents: 500, quantity: 2 },
          { priceInCents: 300, quantity: 1 },
        ]),
      ).toBe(1300);
    });

    it("highest devolve o maior preço unitário, ignorando a quantidade", () => {
      expect(
        contribuicaoDoGrupo("highest", [
          { priceInCents: 4505, quantity: 1 },
          { priceInCents: 5000, quantity: 1 },
        ]),
      ).toBe(5000);
      expect(
        contribuicaoDoGrupo("highest", [{ priceInCents: 4505, quantity: 3 }]),
      ).toBe(4505);
    });

    it("average é a média por unidade, arredondada", () => {
      // (4505 + 5000) / 2 = 4752.5
      expect(
        contribuicaoDoGrupo("average", [
          { priceInCents: 4505, quantity: 1 },
          { priceInCents: 5000, quantity: 1 },
        ]),
      ).toBe(4753);
      // (3000 + 3500 + 4100) / 3 = 3533.33…
      expect(
        contribuicaoDoGrupo("average", [
          { priceInCents: 3000, quantity: 1 },
          { priceInCents: 3500, quantity: 1 },
          { priceInCents: 4100, quantity: 1 },
        ]),
      ).toBe(3533);
    });

    /** 2x o mesmo sabor é uma pizza inteira daquele sabor, pelo preço dele. */
    it("highest e average sobre uma opção repetida degradam para o preço dela", () => {
      const escolhas = [{ priceInCents: 4505, quantity: 2 }];
      expect(contribuicaoDoGrupo("highest", escolhas)).toBe(4505);
      expect(contribuicaoDoGrupo("average", escolhas)).toBe(4505);
    });

    it("grupo sem escolha não contribui", () => {
      for (const regra of ["sum", "highest", "average"] as const) {
        expect(contribuicaoDoGrupo(regra, [])).toBe(0);
      }
    });
  });

  describe("precoUnitario", () => {
    it("soma as contribuições ao preço do produto", () => {
      expect(
        precoUnitario(3000, [
          {
            priceRule: "sum",
            escolhas: [{ priceInCents: 500, quantity: 2 }],
          },
        ]),
      ).toBe(4000);
    });

    /**
     * O achado que mudou a spec: arredondar POR GRUPO produz viés sistemático
     * para cima. Aqui os dois grupos caem em meio centavo, e arredondar cada um
     * daria 8856 em vez de 8855.
     */
    it("arredonda UMA vez, no fim — não por grupo", () => {
      const resultado = precoUnitario(3000, [
        {
          priceRule: "average",
          escolhas: [
            { priceInCents: 4505, quantity: 1 },
            { priceInCents: 5000, quantity: 1 },
          ],
        },
        {
          priceRule: "average",
          escolhas: [
            { priceInCents: 1005, quantity: 1 },
            { priceInCents: 1200, quantity: 1 },
          ],
        },
      ]);

      expect(resultado).toBe(8855);
      expect(resultado).not.toBe(8856); // o que sairia arredondando por grupo
    });

    it("produto sem grupo nenhum custa o preço dele", () => {
      expect(precoUnitario(4890, [])).toBe(4890);
    });
  });
});
