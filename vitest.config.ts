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

    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',

      /**
       * Solo el codigo de servidor.
       *
       * Las pantallas quedan afuera a proposito: no hay pruebas de interfaz
       * todavia, y incluirlas daria un porcentaje bajo que no dice nada util
       * y que esconderia una caida real en el codigo que si esta probado.
       * Entran cuando la Fase 2 traiga pruebas de componentes.
       */
      include: ['src/server/**/*.ts', 'src/modules/**/*.ts', 'src/app/api/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/modules/*/dto.ts'],

      /**
       * Umbrales iniciales, deliberadamente por debajo de lo que hay hoy.
       *
       * No son una meta: son una alarma. Estan puestos unos puntos por debajo
       * de la cobertura real para que una caida se note, sin que el numero
       * oscile entre verde y rojo por un par de lineas. Se suben cuando la
       * cobertura real suba, no antes.
       *
       * Medicion al cierre de la Fase 1:
       *   lineas      84,1 %
       *   sentencias  82,0 %
       *   funciones   85,4 %
       *   ramas       61,8 %
       *
       * Las ramas van muy por detras, y es esperable: cada `?? null`, cada
       * `?.` y cada campo opcional de un esquema cuentan como dos ramas, y
       * muchas son casos que no pueden darse en la practica. Subir ese numero
       * a fuerza de pruebas artificiales no haria el sistema mas seguro.
       */
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 50,
        statements: 73,
      },
    },
  },
})
