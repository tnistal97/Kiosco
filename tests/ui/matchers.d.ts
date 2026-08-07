/**
 * Tipos de los matchers de `@testing-library/jest-dom` dentro de vitest.
 *
 * `expect.extend` los agrega en tiempo de ejecucion (`tests/setup-ui.ts`),
 * pero TypeScript no se entera solo. Esta declaracion se lo dice.
 */

import 'vitest'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- solo suma miembros
  interface Assertion<T = unknown> extends TestingLibraryMatchers<T, void> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- solo suma miembros
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}
