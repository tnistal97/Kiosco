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

/**
 * El dinero no se vuelve numero.
 *
 * Un importe sale de la base como `Decimal` y se opera como `Decimal`. En el
 * momento en que alguien escribe `precio.toNumber()` para "hacer una cuenta
 * rapida", el importe vuelve a ser un `double` de IEEE 754 y con el vuelven
 * los centavos fantasma que toda la Fase 3 existe para eliminar.
 *
 * Ver docs/PHASE3_MONEY_MIGRATION.md. Unico lugar autorizado a cruzar la
 * frontera: `src/server/money.ts`, en una sola funcion documentada.
 */
const PROHIBIDO_DINERO_NUMERO = [
  {
    selector: "CallExpression > MemberExpression[property.name='toNumber']",
    message:
      'No conviertas un importe a number: la aritmetica financiera se hace con Decimal. ' +
      'Usa los helpers de @/server/money (sumar, restar, multiplicar, comparar).',
  },
  {
    selector: "CallExpression[callee.name='Number'] > MemberExpression[property.name='price']",
    message: 'Un precio no se convierte a number. Ver @/server/money.',
  },
]

/**
 * Una cantidad tampoco se vuelve numero.
 *
 * Mismo argumento que el dinero, y con una consecuencia peor: el libro de
 * inventario tiene una restriccion en PostgreSQL que exige
 *
 *   resultingQuantity = previousQuantity + quantity
 *
 * En punto flotante `0.1 + 0.2` da `0.30000000000000004`. Eso no produce un
 * numero feo: produce una fila que la base RECHAZA, y con ella una venta que no
 * se puede registrar. La regla del `.toNumber()` ya la cubre PROHIBIDO_DINERO;
 * esto agrega la otra puerta, que es envolver la columna en `Number(...)`.
 *
 * Ver docs/PHASE3_QUANTITY_MIGRATION.md.
 */
const PROHIBIDO_CANTIDAD_NUMERO = [
  {
    selector:
      "CallExpression[callee.name='Number'] > MemberExpression" +
      '[property.name=/^(quantity|previousQuantity|resultingQuantity|minimumStock|totalStock|unitsPerPurchaseUnit)$/]',
    message:
      'Una cantidad no se convierte a number: la aritmetica del inventario se hace con Decimal ' +
      '(servidor) o con milesimas enteras (navegador). Usa los helpers de @/server/cantidad ' +
      'o de @/lib/cantidad.',
  },
  {
    selector:
      'CallExpression[callee.name=/^(parseFloat|parseInt)$/] > MemberExpression' +
      '[property.name=/^(quantity|previousQuantity|resultingQuantity|minimumStock|totalStock)$/]',
    message: 'Una cantidad no se parsea a number. Ver @/lib/cantidad.',
  },
]

/**
 * El stock no se escribe: se mueve.
 *
 * Desde la Fase 3A el stock es el saldo de un libro, no un numero suelto:
 *
 *   para todo producto:  suma(StockMovement.quantity) == BranchStock.quantity
 *
 * Alcanza con UN `update` suelto sobre BranchStock en cualquier parte de la
 * aplicacion para que esa igualdad deje de ser cierta, y lo peor es que no se
 * nota: el stock queda "bien" y el libro queda mal, que es exactamente el caso
 * que hace imposible confiar en el historial.
 *
 * Las LECTURAS (findUnique, findMany, count, aggregate) siguen permitidas en
 * todos lados: leer un saldo no lo corrompe.
 *
 * Ver docs/INVENTORY_LEDGER.md, seccion 5. Unico lugar autorizado a escribir:
 * `src/modules/inventory/service.ts`.
 */
const PROHIBIDO_ESCRIBIR_STOCK = [
  {
    selector:
      "CallExpression > MemberExpression[object.property.name='branchStock']" +
      '[property.name=/^(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$/]',
    message:
      'El stock no se escribe directamente. Usa applyStockMovement() de ' +
      '@/modules/inventory/service, que ademas deja la fila en el libro. ' +
      'Ver docs/INVENTORY_LEDGER.md.',
  },
  {
    // Solo ESCRITURAS, igual que el selector de arriba. Un SELECT sobre
    // BranchStock es legitimo desde cualquier lado; lo que no puede salir del
    // servicio de inventario es la sentencia que cambia el saldo.
    selector:
      'TemplateElement[value.raw=/(UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+"BranchStock"/]',
    message:
      'SQL crudo que escribe sobre BranchStock, fuera del servicio de inventario. ' +
      'Toda modificacion de stock pasa por applyStockMovement().',
  },
  // Desde la Fase 4D la frontera cubre TAMBIEN el stock por lote y el libro de
  // atribuciones. Es la misma invariante un nivel mas abajo:
  //
  //   BranchLotStock.quantity == suma(movimientos del lote) + suma(atribuciones)
  //
  // Sin esto, un `update` suelto sobre BranchLotStock dejaria el stock del lote
  // "bien" y su libro sin explicarlo, que es el caso que hace imposible contestar
  // "de que partida salieron estas ocho unidades".
  {
    selector:
      "CallExpression > MemberExpression[object.property.name='branchLotStock']" +
      '[property.name=/^(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$/]',
    message:
      'El stock por lote no se escribe directamente. Usa applyStockMovement() o ' +
      'applyLotAssignment() de @/modules/inventory/service. ' +
      'Ver docs/LOT_TRACKING_DESIGN.md.',
  },
  {
    selector:
      "CallExpression > MemberExpression[object.property.name='lotAssignment']" +
      '[property.name=/^(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$/]',
    message:
      'Las atribuciones de lote no se escriben directamente. Usa applyLotAssignment() ' +
      'de @/modules/inventory/service, que comprueba el tope bajo bloqueo. ' +
      'Ver docs/LOT_TRACKING_DESIGN.md.',
  },
  {
    selector:
      'TemplateElement[value.raw=/(UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+"(BranchLotStock|LotAssignment)"/]',
    message:
      'SQL crudo que escribe sobre el stock por lote, fuera del servicio de inventario. ' +
      'Ver docs/LOT_TRACKING_DESIGN.md.',
  },
]

/**
 * El saldo de un cliente tampoco se escribe: se mueve.
 *
 * Desde la Fase 4A la cuenta corriente es el saldo de un libro:
 *
 *   para todo cliente:  suma(CustomerAccountMovement.amount) == Client.balance
 *
 * Es la misma frontera que la del stock y protege algo mas delicado: alcanza un
 * `update` suelto con `balance` adentro para bajarle la deuda a alguien sin
 * dejar rastro. El saldo quedaria "bien" y el libro no lo explicaria, que es
 * justo lo que un cliente reclama cuando dice "yo ya te pague".
 *
 * Editar el NOMBRE, el telefono o el limite de un cliente sigue permitido desde
 * el servicio: lo unico cerrado es la columna del saldo.
 *
 * Ver docs/CUSTOMER_ACCOUNT_LEDGER.md. Unico lugar autorizado a escribirlo:
 * `src/modules/clients/cuenta.ts`.
 */
const PROHIBIDO_ESCRIBIR_SALDO = [
  {
    // `…client.<lo que sea>({ … data: { … balance … } … })`.
    //
    // Acotado a `data` a proposito. La version anterior no lo estaba y tambien
    // marcaba las LECTURAS --un `select: { balance: true }` es legitimo desde
    // cualquier lado-- lo que no se notaba solo porque los `select` de este
    // proyecto viven en constantes aparte. Esa es la peor forma de que una
    // regla "funcione": el dia que alguien escriba el select en linea, la
    // esquiva extrayendolo a una constante, y de paso deja de protegerlo de
    // las escrituras. Lo descubrio la Fase 4B al escribir la regla espejo.
    selector:
      "CallExpression[callee.object.property.name='client'] " +
      "Property[key.name='data'] Property[key.name='balance']",
    message:
      'El saldo de un cliente no se escribe directamente. Usa applyAccountMovement() de ' +
      '@/modules/clients/cuenta, que ademas deja la fila en el libro y comprueba el limite. ' +
      'Ver docs/CUSTOMER_ACCOUNT_LEDGER.md.',
  },
  {
    // Solo ESCRITURAS. Un SELECT sobre "Client" es legitimo desde cualquier
    // lado; lo que no puede salir del modulo es la sentencia que mueve el saldo.
    selector: 'TemplateElement[value.raw=/(UPDATE|DELETE\\s+FROM)\\s+"Client"/]',
    message:
      'SQL crudo que escribe sobre Client, fuera del libro de cuenta corriente. ' +
      'Todo cambio de saldo pasa por applyAccountMovement().',
  },
]

/**
 * El saldo de un proveedor tampoco se escribe: se mueve.
 *
 * Desde la Fase 4B las cuentas por pagar son el saldo de un libro:
 *
 *   para todo proveedor:  suma(SupplierAccountMovement.amount) == Supplier.balance
 *
 * Es la misma frontera que la del saldo del cliente, mirada del otro lado, y
 * protege el caso simetrico: alcanza un `update` suelto con `balance` adentro
 * para dar por pagada una deuda que nadie pago. El saldo quedaria "bien" y el
 * libro no lo explicaria, que es justo lo que un proveedor reclama cuando dice
 * "esa entrega no me la pagaste".
 *
 * Editar el NOMBRE, el telefono o el plazo de pago de un proveedor sigue
 * permitido desde el servicio: lo unico cerrado es la columna del saldo.
 *
 * Ver docs/SUPPLIER_ACCOUNT_LEDGER.md. Unico lugar autorizado a escribirlo:
 * `src/modules/suppliers/cuenta.ts`.
 */
const PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR = [
  {
    // `…supplier.<lo que sea>({ … data: { … balance … } … })`. Acotado a
    // `data`: lo que se prohibe es ESCRIBIR el saldo, no leerlo. Ver la nota
    // equivalente en PROHIBIDO_ESCRIBIR_SALDO.
    selector:
      "CallExpression[callee.object.property.name='supplier'] " +
      "Property[key.name='data'] Property[key.name='balance']",
    message:
      'El saldo de un proveedor no se escribe directamente. Usa ' +
      'applySupplierAccountMovement() de @/modules/suppliers/cuenta, que ademas deja la fila ' +
      'en el libro. Ver docs/SUPPLIER_ACCOUNT_LEDGER.md.',
  },
  {
    // Solo ESCRITURAS. Un SELECT sobre "Supplier" es legitimo desde cualquier
    // lado; lo que no puede salir del modulo es la sentencia que mueve el saldo.
    selector: 'TemplateElement[value.raw=/(UPDATE|DELETE\\s+FROM)\\s+"Supplier"/]',
    message:
      'SQL crudo que escribe sobre Supplier, fuera del libro de cuentas por pagar. ' +
      'Todo cambio de saldo pasa por applySupplierAccountMovement().',
  },
]

/**
 * SEXTA frontera: la imputacion de pagos a obligaciones. Fase 4C.
 *
 * Es distinta de las cinco anteriores y conviene decir en que. Aquellas protegen
 * un SALDO --stock, cuenta de cliente, cuenta de proveedor-- de que alguien lo
 * escriba sin dejar la fila del libro que lo explica. Esta protege una tabla que
 * no tiene saldo detras: `SupplierPaymentAllocation` no mueve nada.
 *
 * Lo que protege es LA COMPROBACION. Los dos topes de una imputacion --no
 * pasarse del pago, no pasarse de la obligacion neta-- no se pueden expresar en
 * una restriccion de la base, porque cada uno es la suma de OTRA tabla. Se hacen
 * cumplir tomando bloqueos en un orden preciso, y eso solo existe dentro de
 * `imputacion.ts`. Un `create` escrito en cualquier otro lado los saltearia sin
 * que nada se queje: la fila entraria, la reconciliacion la encontraria semanas
 * despues, y para entonces habria un proveedor con dos entregas marcadas como
 * pagadas por la misma plata.
 *
 * Unico lugar autorizado: `src/modules/suppliers/imputacion.ts`.
 * Ver docs/SUPPLIER_PAYMENT_ALLOCATION.md.
 */
const PROHIBIDO_IMPUTAR = [
  {
    selector: "CallExpression[callee.object.property.name='supplierPaymentAllocation']",
    message:
      'Las imputaciones no se escriben directamente. Usa imputar() de ' +
      '@/modules/suppliers/imputacion, que comprueba los dos topes bajo bloqueo de fila. ' +
      'Ver docs/SUPPLIER_PAYMENT_ALLOCATION.md.',
  },
  {
    selector:
      'TemplateElement[value.raw=/(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"SupplierPaymentAllocation"/]',
    message:
      'SQL crudo que escribe imputaciones, fuera de imputacion.ts. Los dos topes se ' +
      'comprueban bajo bloqueo y ese bloqueo solo existe ahi.',
  },
]

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
      // Resultados de las pruebas de extremo a extremo: capturas, trazas y
      // el informe HTML que genera Playwright.
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
      // Service worker generado por Serwist en cada construccion. El fuente
      // que si se revisa es src/app/sw.ts.
      'public/sw.js',
      'public/sw.js.map',
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

  // ------------------------------------- el navegador no habla con la base
  //
  // Importar Prisma desde un componente de cliente no da error de compilacion:
  // da un paquete gigante y, en el peor caso, filtra la cadena de conexion al
  // navegador. Es un error facil de cometer --alcanza con importar una
  // constante desde un servicio-- y muy dificil de notar.
  {
    files: ['src/components/**', 'src/hooks/**', 'src/store/**', 'src/lib/api-client.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '**/lib/prisma', '@/lib/prisma'],
              message:
                'Prisma es del servidor. Si hace falta un tipo o una constante, ' +
                'ponerlo en el modulo de esquemas o en el dto, que no importan Prisma.',
            },
            {
              group: ['@/modules/*/service', '@/modules/*/service.*', '@/server/services/*'],
              message:
                'Los servicios corren en el servidor y arrastran Prisma. ' +
                'Las constantes compartidas van en schemas.ts.',
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------- las cinco fronteras que no se cruzan
  //
  // `no-restricted-syntax` es UNA regla: cuando dos bloques la configuran para
  // el mismo archivo, el segundo REEMPLAZA al primero en vez de sumarse. Por
  // eso los selectores se declaran arriba (PROHIBIDO_*) y cada bloque de aca
  // abajo lista el conjunto COMPLETO que le corresponde. Siete bloques, porque
  // cada frontera tiene su propia excepcion:
  //
  //   1. todo src/                        → stock + saldos + imputacion
  //   2. modules, server y api            → las seis
  //   3. src/server/money.ts              → todas menos dinero     (la cruza)
  //   4. src/server/cantidad.ts           → todas menos cantidad   (la cruza)
  //   5. modules/inventory/service.ts     → todas menos stock      (la cruza)
  //   6. modules/clients/cuenta.ts        → todas menos saldo      (la cruza)
  //   7. modules/suppliers/cuenta.ts      → todas menos proveedor  (la cruza)
  //   8. modules/suppliers/imputacion.ts  → todas menos imputacion (la cruza)
  //
  // Sin este cuidado, agregar una frontera nueva apagaria las anteriores en
  // silencio: los tests seguirian pasando y las reglas no protegerian nada.
  // Hay una prueba estatica que lo comprueba archivo por archivo, justamente
  // porque este es el error que no se nota.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PROHIBIDO_ESCRIBIR_STOCK,
        ...PROHIBIDO_ESCRIBIR_SALDO,
        ...PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR,
        ...PROHIBIDO_IMPUTAR,
      ],
    },
  },
  {
    files: ['src/modules/**/*.ts', 'src/server/**/*.ts', 'src/app/api/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PROHIBIDO_ESCRIBIR_STOCK,
        ...PROHIBIDO_ESCRIBIR_SALDO,
        ...PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR,
        ...PROHIBIDO_IMPUTAR,
        ...PROHIBIDO_DINERO_NUMERO,
        ...PROHIBIDO_CANTIDAD_NUMERO,
      ],
    },
  },
  {
    files: ['src/server/money.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PROHIBIDO_ESCRIBIR_STOCK,
        ...PROHIBIDO_ESCRIBIR_SALDO,
        ...PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR,
        ...PROHIBIDO_IMPUTAR,
        ...PROHIBIDO_CANTIDAD_NUMERO,
      ],
    },
  },
  {
    files: ['src/server/cantidad.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PROHIBIDO_ESCRIBIR_STOCK,
        ...PROHIBIDO_ESCRIBIR_SALDO,
        ...PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR,
        ...PROHIBIDO_IMPUTAR,
        ...PROHIBIDO_DINERO_NUMERO,
      ],
    },
  },
  {
    files: ['src/modules/inventory/service.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PROHIBIDO_ESCRIBIR_SALDO,
        ...PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR,
        ...PROHIBIDO_IMPUTAR,
        ...PROHIBIDO_DINERO_NUMERO,
        ...PROHIBIDO_CANTIDAD_NUMERO,
      ],
    },
  },
  {
    files: ['src/modules/clients/cuenta.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PROHIBIDO_ESCRIBIR_STOCK,
        ...PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR,
        ...PROHIBIDO_IMPUTAR,
        ...PROHIBIDO_DINERO_NUMERO,
        ...PROHIBIDO_CANTIDAD_NUMERO,
      ],
    },
  },
  {
    files: ['src/modules/suppliers/cuenta.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PROHIBIDO_ESCRIBIR_STOCK,
        ...PROHIBIDO_ESCRIBIR_SALDO,
        ...PROHIBIDO_IMPUTAR,
        ...PROHIBIDO_DINERO_NUMERO,
        ...PROHIBIDO_CANTIDAD_NUMERO,
      ],
    },
  },

  // La octava excepcion: la unica puerta de las imputaciones cruza SU propia
  // frontera y ninguna otra.
  {
    files: ['src/modules/suppliers/imputacion.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PROHIBIDO_ESCRIBIR_STOCK,
        ...PROHIBIDO_ESCRIBIR_SALDO,
        ...PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR,
        ...PROHIBIDO_DINERO_NUMERO,
        ...PROHIBIDO_CANTIDAD_NUMERO,
      ],
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
    files: ['*.{js,mjs,cjs,ts}', 'scripts/**/*.{ts,mjs,js}', 'prisma/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      // `scripts/verificar-pwa.mjs` usa `await` en el nivel superior, que
      // solo es valido en un modulo.
      sourceType: 'module',
      ecmaVersion: 'latest',
    },
    rules: {
      // Los scripts de mantenimiento escriben por consola a proposito.
      'no-console': 'off',
    },
  },

  // ------------------------------------------------ automatizacion con navegador
  // `scripts/screenshots.ts`, `scripts/ui-metrics.ts` y
  // `scripts/verificar-pwa.mjs` corren en Node, pero pasan funciones a
  // `page.evaluate()`, que las ejecuta DENTRO del navegador. Ahi `document`,
  // `caches` y `getComputedStyle` existen de verdad.
  {
    files: ['scripts/screenshots.ts', 'scripts/ui-metrics.ts', 'scripts/verificar-pwa.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
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
