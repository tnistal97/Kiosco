// @ts-check
/**
 * Configuracion plana de ESLint 9.
 *
 * No interactiva y apta para CI: `eslint .` termina solo y devuelve un codigo
 * de salida distinto de cero cuando encuentra un error. Reemplaza a
 * `next lint`, deprecado en Next 15.5.
 *
 * El analisis usa informacion de tipos (projectService) porque las reglas que
 * de verdad importan aca --promesas sin await, condiciones siempre ciertas,
 * valores `any` que se propagan-- no se pueden detectar solo con la sintaxis.
 */

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import next from '@next/eslint-plugin-next'
import vitest from '@vitest/eslint-plugin'
import prettier from 'eslint-config-prettier/flat'
import globals from 'globals'

export default tseslint.config(
  // ---------------------------------------------------------------- ignorados
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'prisma/client/**',
      'generated/**',
      // Generados por next-pwa en cada build.
      'public/sw.js',
      'public/sw.js.map',
      'public/workbox-*.js',
      'public/fallback-*.js',
    ],
  },

  // ------------------------------------------------------------------- base JS
  js.configs.recommended,

  // ------------------------------------------------- TypeScript con tipos
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // --------------------------------------------------------- reglas del proyecto
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      // -- Variables e imports sin usar ----------------------------------
      // El prefijo `_` marca lo que se descarta a proposito, por ejemplo al
      // desestructurar para quitar `password` de un objeto.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // -- Promesas no manejadas -----------------------------------------
      // Una promesa sin await dentro de una transaccion de Prisma se pierde
      // en silencio: la transaccion cierra antes de que la escritura ocurra.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],

      // -- Tipos inseguros -----------------------------------------------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // -- Expresiones siempre verdaderas o siempre falsas ----------------
      // Detecta comprobaciones muertas: `if (session)` cuando el tipo ya
      // garantiza que existe, que suele significar que la guarda real falta.
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      // -- Codigo inalcanzable y errores de control de flujo ---------------
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-constant-condition': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'require-atomic-updates': 'error',

      // -- Higiene general ------------------------------------------------
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'off',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },

  // ------------------------------------------------------------- React / Next
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      '@next/next': next,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,

      // -- Hooks -----------------------------------------------------------
      // Las dependencias mal declaradas de useEffect son la causa habitual de
      // los bucles de peticiones y de los datos que no se refrescan.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // -- Errores comunes de React ----------------------------------------
      'react/jsx-key': ['error', { checkFragmentShorthand: true }],
      'react/no-array-index-key': 'warn',
      'react/jsx-no-target-blank': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-unescaped-entities': 'off', // el castellano usa comillas y acentos
      'react/prop-types': 'off', // TypeScript ya cubre esto
    },
  },

  // ------------------------------------------------------------------- tests
  {
    files: ['tests/**/*.ts'],
    plugins: { vitest },
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...vitest.configs.recommended.rules,
      // Un `expect` dentro de un helper compartido sigue siendo una asercion.
      'vitest/expect-expect': 'off',
      // `expect(valor, 'por que importa')` es API de vitest, no un error. Ese
      // segundo argumento es lo que aparece cuando la prueba falla, y en esta
      // suite explica que agujero de seguridad cubre cada caso.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
    },
  },

  // ------------------------------------------- configuracion y scripts sueltos
  {
    files: ['*.{js,mjs,cjs,ts}', 'scripts/**/*.ts', 'prisma/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Los scripts de mantenimiento escriben por consola a proposito.
      'no-console': 'off',
    },
  },

  // ---------------------------------------------------------- ficheros sin tipos
  // Archivos JavaScript planos que no entran en el programa de TypeScript.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ------------------------------------------------------------------ prettier
  // Ultimo a proposito: apaga las reglas de estilo que Prettier ya resuelve,
  // para que ninguna de las dos herramientas pelee con la otra.
  prettier,
)
