import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],

    // Los tests comparten una unica base de datos y la vacian entre casos.
    // Ejecutarlos en paralelo haria que unos borren los datos de otros.
    // Los tests de concurrencia usan Promise.all DENTRO de un mismo caso,
    // que es donde de verdad hace falta el paralelismo.
    fileParallelism: false,
    sequence: { concurrent: false },

    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
