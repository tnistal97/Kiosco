/**
 * Caso critico 11 — no puede falsificarse una entrada de auditoria mediante
 * una API publica.
 *
 * Y en general: los endpoints peligrosos que no se usan se retiran, no se
 * esconden. Estos tests miran el arbol de archivos porque una ruta borrada
 * no se puede importar, y porque asi el fallo dice exactamente que archivo
 * sobra.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '../helpers/db'

const ROOT = path.resolve(__dirname, '..', '..')

afterAll(async () => {
  await prisma.$disconnect()
})

interface Retirado {
  archivo: string
  motivo: string
}

const DEBEN_NO_EXISTIR: Retirado[] = [
  {
    archivo: 'src/app/api/logs/route.ts',
    motivo:
      'POST /api/logs permite crear entradas de auditoria sin autenticacion y a nombre ' +
      'de cualquier usuario. La auditoria debe generarse solo desde el servidor.',
  },
  {
    archivo: 'src/app/api/stock/route.ts',
    motivo:
      'POST /api/stock acepta branchId del cliente sin autenticacion: permite alterar ' +
      'el inventario de cualquier sucursal. GET expone el stock de todas las sucursales.',
  },
  {
    archivo: 'src/app/api/sales/recent/route.ts',
    motivo:
      'GET /api/sales/recent no comprueba sesion ni sucursal y expone importes de venta. ' +
      'Ninguna pantalla lo usa.',
  },
  {
    archivo: 'test.js',
    motivo:
      'Script en la raiz del repositorio que borra productos, stock e items de venta ' +
      'sin ninguna guarda de entorno. Un `node test.js` con el .env equivocado vacia produccion.',
  },
]

describe('Caso 11 — endpoints peligrosos retirados', () => {
  for (const { archivo, motivo } of DEBEN_NO_EXISTIR) {
    it(`${archivo} ya no existe`, () => {
      const existe = existsSync(path.join(ROOT, archivo))
      expect(existe, `Sigue presente. ${motivo}`).toBe(false)
    })
  }

  it('ninguna ruta de API expone la creacion directa de AuditLog', async () => {
    const { glob } = await import('node:fs/promises').then(async () => {
      const { readdirSync, readFileSync, statSync } = await import('node:fs')
      const walk = (dir: string): string[] => {
        const out: string[] = []
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry)
          if (statSync(full).isDirectory()) out.push(...walk(full))
          else if (entry === 'route.ts') out.push(full)
        }
        return out
      }
      return {
        glob: walk(path.join(ROOT, 'src/app/api')).map((f) => ({
          file: path.relative(ROOT, f),
          content: readFileSync(f, 'utf8'),
        })),
      }
    })

    // Las rutas deben auditar a traves del helper `audit()`, que fija el
    // userId desde la sesion. Nunca escribiendo la tabla directamente con
    // datos del cuerpo de la peticion.
    for (const { file, content } of glob) {
      const escrituraDirecta = /auditLog\.create\s*\(\s*\{\s*data\s*\}/.test(content)
      expect(
        escrituraDirecta,
        `${file} escribe en AuditLog con el objeto recibido del cliente`,
      ).toBe(false)
    }
  })
})

describe('El middleware debe estar dentro de src/', () => {
  it('src/middleware.ts existe', () => {
    expect(
      existsSync(path.join(ROOT, 'src/middleware.ts')),
      'Con un directorio src/, Next.js solo reconoce el middleware en src/middleware.ts. ' +
        'En la raiz se excluye del build en silencio y la autenticacion de navegacion nunca corre.',
    ).toBe(true)
  })

  it('no queda un middleware.ts en la raiz', () => {
    expect(
      existsSync(path.join(ROOT, 'middleware.ts')),
      'Un middleware en la raiz no se ejecuta pero aparenta hacerlo. Debe borrarse.',
    ).toBe(false)
  })

  it('el middleware no importa Prisma ni jsonwebtoken', async () => {
    const { readFileSync } = await import('node:fs')
    const ruta = path.join(ROOT, 'src/middleware.ts')
    if (!existsSync(ruta)) return

    const contenido = readFileSync(ruta, 'utf8')
    expect(
      /from\s+['"]@?\/?lib\/prisma['"]|@prisma\/client/.test(contenido),
      'El middleware corre en el runtime Edge: Prisma no funciona ahi',
    ).toBe(false)
    expect(
      /from\s+['"]jsonwebtoken['"]/.test(contenido),
      'jsonwebtoken depende de crypto de Node y no funciona en Edge. Usar jose.',
    ).toBe(false)
  })
})

describe('No conviven dos sistemas de autenticacion', () => {
  it('next-auth no figura en package.json', async () => {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const todas = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(
      'next-auth' in todas,
      'next-auth tiene una vulnerabilidad critica y no se usa en ningun archivo del proyecto',
    ).toBe(false)
  })

  it('jsonwebtoken ya no se usa en el codigo', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) out.push(...walk(full))
        else if (/\.tsx?$/.test(entry)) out.push(full)
      }
      return out
    }

    const usan = walk(path.join(ROOT, 'src'))
      .filter((f) => /from\s+['"]jsonwebtoken['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f))

    expect(usan, `Todavia usan jsonwebtoken: ${usan.join(', ')}`).toEqual([])
  })
})
