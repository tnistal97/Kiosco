import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  /**
   * JSX para las pruebas de componentes.
   *
   * `tsconfig.json` deja `jsx: "preserve"` porque quien transforma en la
   * aplicacion es Next. Vitest no pasa por Next, y ese `preserve` le llega
   * igual, asi que sin este complemento los `.tsx` de prueba no compilan.
   */
  plugins: [react()],

  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    /**
     * Node por omision, jsdom donde haga falta.
     *
     * La mayoria de la suite habla con PostgreSQL y no necesita un DOM;
     * montarlo para todo costaria varios segundos por archivo. Los archivos
     * de `tests/ui/` lo piden con `@vitest-environment jsdom` en su cabecera,
     * que ademas deja el entorno a la vista de quien abre el archivo.
     */
    environment: 'node',
    globals: false,
    setupFiles: ['tests/setup.ts', 'tests/setup-ui.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],

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
      include: [
        'src/server/**/*.ts',
        'src/modules/**/*.ts',
        'src/app/api/**/*.ts',
        // Desde la Fase 2 entran las piezas de interfaz que SI tienen pruebas
        // de componentes. Las pantallas (`src/app/*/page.tsx`) siguen afuera:
        // las cubren las pruebas de extremo a extremo, que corren en otro
        // proceso y cuya cobertura vitest no puede medir. Incluirlas daria un
        // porcentaje bajo que no dice nada y esconderia una caida real.
        'src/components/ui/**/*.{ts,tsx}',
        'src/components/shell/navigation.ts',
        'src/store/**/*.ts',
        'src/hooks/**/*.ts',
      ],
      exclude: ['**/*.d.ts', 'src/modules/*/dto.ts'],

      /**
       * Umbrales: una alarma, no una meta.
       *
       * Estan puestos unos puntos por debajo de la cobertura real para que
       * una caida se note, sin que el numero oscile entre verde y rojo por un
       * par de lineas. Se suben cuando la cobertura real sube, nunca se bajan
       * para que un cambio pase.
       *
       * Medicion al cierre de la Fase 2, con las piezas de interfaz ya
       * dentro del alcance:
       *
       *   lineas      81,6 %   (Fase 1: 84,1 %, solo servidor)
       *   sentencias  78,7 %   (Fase 1: 82,0 %)
       *   funciones   80,4 %   (Fase 1: 85,4 %)
       *   ramas       69,5 %   (Fase 1: 61,8 %)
       *
       * Los tres primeros bajan y el cuarto sube, y las dos cosas son la
       * misma: el alcance se amplio de "solo servidor" a "servidor mas los
       * componentes probados". Sobre el mismo alcance de la Fase 1 la
       * cobertura de servidor subio; lo que entro nuevo trae mas ramas
       * cubiertas y algunas funciones de presentacion que no lo estan.
       *
       * Las ramas siguen por detras y es esperable: cada `?? null`, cada `?.`
       * y cada campo opcional de un esquema cuentan como dos, y muchas no
       * pueden darse en la practica. Subir ese numero a fuerza de pruebas
       * artificiales no haria el sistema mas seguro.
       */
      thresholds: {
        lines: 78,
        functions: 76,
        branches: 63,
        statements: 75,
      },
    },
  },
})
