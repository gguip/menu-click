/**
 * Nome do banco de teste, isolado do banco de desenvolvimento (`capstone`).
 * Único lugar onde esse nome é definido — `global-setup.ts` o usa para criar
 * o banco e rodar as migrations; `vitest.config.ts` o injeta como `DB_NAME`
 * para o pool da app (`src/db/pool.ts`) apontar pra lá durante os testes.
 */
export const TEST_DB_NAME = "capstone_test";
