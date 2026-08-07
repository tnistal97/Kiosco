import { defineConfig, devices } from '@playwright/test'

/**
 * Pruebas de extremo a extremo.
 *
 * Corren contra la construccion de PRODUCCION, no contra `next dev`: es la
 * unica forma de que lo que se prueba se parezca a lo que se despliega
 * --minificado, con el service worker activo y sin recarga en caliente--.
 *
 * La base es la de desarrollo, descartable, sembrada con datos ficticios
 * antes de empezar (`e2e/seed.setup.ts`). Estas pruebas ESCRIBEN: registran
 * ventas, anulan y ajustan stock. Nunca deben apuntar a otra cosa.
 *
 *   npm run build
 *   npm run e2e
 */

const PUERTO = Number(process.env.E2E_PORT ?? 3101)
const BASE = `http://127.0.0.1:${PUERTO}`

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_dev?schema=public'

const nombreBase = DATABASE_URL.split('/').pop()?.split('?')[0] ?? ''
if (!nombreBase.endsWith('_dev') && !nombreBase.endsWith('_e2e')) {
  throw new Error(
    `Las pruebas E2E escriben en la base. "${nombreBase}" no termina en "_dev" ni en "_e2e".`,
  )
}

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',

  // Escriben en la misma base: en paralelo se pisarian el stock entre si.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE,
    colorScheme: 'dark',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'datos', testMatch: /seed\.setup\.ts/ },
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
      dependencies: ['datos'],
      testIgnore: /movil\.spec\.ts/,
    },
    {
      name: 'movil',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
      dependencies: ['datos'],
      testMatch: /movil\.spec\.ts/,
    },
  ],

  webServer: {
    command: `npx next start -p ${PUERTO}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATABASE_URL, NODE_ENV: 'production' },
  },
})
