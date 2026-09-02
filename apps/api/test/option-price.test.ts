import { describe, expect, it } from "vitest";
import {
  groupContribution,
  divideRounded,
  unitPrice,
} from "../src/domain/option.ts";

/**
 * A aritmética de dinheiro do cardápio.
 *
 * Não toca no banco de propósito: é a única parte do sistema em que um erro de
 * um centavo se propaga para todo pedido, e ela precisa ser verificável sem
 * subir nada.
 */
describe("aritmética de preço das opções", () => {
  describe("divideRounded", () => {
    it("arredonda meio para cima", () => {
      expect(divideRounded(5, 2)).toBe(3); // 2.5
      expect(divideRounded(7, 2)).toBe(4); // 3.5
      expect(divideRounded(9505, 2)).toBe(4753); // 4752.5
    });

    it("não arredonda o que já é inteiro", () => {
      expect(divideRounded(8180, 2)).toBe(4090);
      expect(divideRounded(0, 3)).toBe(0);
    });

    /**
     * A razão de a função existir em vez de `Math.round(n / d)`: remover a
     * classe inteira de dúvida sobre float. O teste valida a equivalência
     * contra uma implementação **independente** usando a divisão IEEE-754,
     * em toda a faixa de magnitudes de um cardápio.
     */
    it("concorda com Math.round(n / d) em toda a faixa de um cardápio", () => {
      for (let d = 1; d <= 6; d++) {
        for (let n = 0; n <= 30000; n += 7) {
          const independent = Math.round(n / d);
          expect(divideRounded(n, d)).toBe(independent);
        }
      }
    });
  });

  describe("groupContribution", () => {
    it("sum soma preço vezes quantidade", () => {
      expect(
        groupContribution("sum", [
          { priceInCents: 500, quantity: 2 },
          { priceInCents: 300, quantity: 1 },
        ]),
      ).toBe(1300);
    });

    it("highest devolve o maior preço unitário, ignorando a quantidade", () => {
      expect(
        groupContribution("highest", [
          { priceInCents: 4505, quantity: 1 },
          { priceInCents: 5000, quantity: 1 },
        ]),
      ).toBe(5000);
      expect(
        groupContribution("highest", [{ priceInCents: 4505, quantity: 3 }]),
      ).toBe(4505);
    });

    it("average é a média por unidade, arredondada", () => {
      // (4505 + 5000) / 2 = 4752.5
      expect(
        groupContribution("average", [
          { priceInCents: 4505, quantity: 1 },
          { priceInCents: 5000, quantity: 1 },
        ]),
      ).toBe(4753);
      // (3000 + 3500 + 4100) / 3 = 3533.33…
      expect(
        groupContribution("average", [
          { priceInCents: 3000, quantity: 1 },
          { priceInCents: 3500, quantity: 1 },
          { priceInCents: 4100, quantity: 1 },
        ]),
      ).toBe(3533);
    });

    /** 2x o mesmo sabor é uma pizza inteira daquele sabor, pelo preço dele. */
    it("highest e average sobre uma opção repetida degradam para o preço dela", () => {
      const choices = [{ priceInCents: 4505, quantity: 2 }];
      expect(groupContribution("highest", choices)).toBe(4505);
      expect(groupContribution("average", choices)).toBe(4505);
    });

    it("grupo sem escolha não contribui", () => {
      for (const rule of ["sum", "highest", "average"] as const) {
        expect(groupContribution(rule, [])).toBe(0);
      }
    });
  });

  describe("unitPrice", () => {
    it("soma as contribuições ao preço do produto", () => {
      expect(
        unitPrice(3000, [
          {
            priceRule: "sum",
            choices: [{ priceInCents: 500, quantity: 2 }],
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
      const resultado = unitPrice(3000, [
        {
          priceRule: "average",
          choices: [
            { priceInCents: 4505, quantity: 1 },
            { priceInCents: 5000, quantity: 1 },
          ],
        },
        {
          priceRule: "average",
          choices: [
            { priceInCents: 1005, quantity: 1 },
            { priceInCents: 1200, quantity: 1 },
          ],
        },
      ]);

      expect(resultado).toBe(8855);
      expect(resultado).not.toBe(8856); // o que sairia arredondando por grupo
    });

    it("produto sem grupo nenhum custa o preço dele", () => {
      expect(unitPrice(4890, [])).toBe(4890);
    });
  });
});
