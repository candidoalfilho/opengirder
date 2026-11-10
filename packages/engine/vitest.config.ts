import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // os modelos de referência com fases construtivas levam alguns segundos sob carga da máquina
    testTimeout: 30000,
  },
})
