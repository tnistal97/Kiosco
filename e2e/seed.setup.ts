import { test as setup } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * Datos ficticios antes de cada corrida.
 *
 * Las pruebas de extremo a extremo escriben: registran ventas, anulan y
 * ajustan stock. Sin sembrar de nuevo, la segunda corrida arranca con el
 * stock que dejo la primera y los numeros dejan de cuadrar.
 */
setup('sembrar datos ficticios', () => {
  const url =
    process.env.E2E_DATABASE_URL ??
    'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_dev?schema=public'

  execFileSync('npm', ['run', 'seed:demo'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
})
