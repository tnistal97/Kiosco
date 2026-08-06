// src/app/api/users/route.ts
import { z } from 'zod'
import { NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { idSchema, shortText } from '@/server/http/validate'
import { audit } from '@/server/audit/audit'
import { conflict, invalid } from '@/server/http/errors'
import { knownRoles } from '@/server/authz/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Lista de campos devueltos. Es una lista blanca explicita, no un `include`.
 *
 * La version anterior era `findMany({ include: { role, branch } })`, que
 * devuelve TODAS las columnas del modelo User, incluida `password`. Con eso,
 * un GET sin autenticar entregaba los hashes bcrypt de todo el personal.
 */
const CAMPOS_PUBLICOS = {
  id: true,
  username: true,
  name: true,
  isActive: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
} as const

export const GET = handler(
  {
    auth: 'session',
    permission: 'users.view',
    audit: 'GET /api/users',
  },
  async ({ session }) => {
    // Un administrador ve el personal de su sucursal. Ver el de todas las
    // sucursales sera una funcion aparte cuando exista la pantalla.
    return prisma.user.findMany({
      where: { branchId: session.branchId },
      select: CAMPOS_PUBLICOS,
      orderBy: { name: 'asc' },
    })
  },
)

/**
 * Alta de usuario.
 *
 * `.strict()` es lo que cierra la escalada de privilegios: la version anterior
 * hacia `create({ data: { ...body, password: hash } })`, asi que cualquier
 * campo del cuerpo llegaba a la base. Bastaba con mandar `roleId` del rol
 * admin para crearse un administrador, sin sesion.
 */
const crearUsuarioSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'El usuario debe tener al menos 3 caracteres')
      .max(50)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, numeros, punto, guion y guion bajo'),
    name: shortText(100),
    password: z
      .string()
      .min(10, 'La contrasena debe tener al menos 10 caracteres')
      .max(200),
    roleId: idSchema,
  })
  .strict()

export const POST = handler(
  {
    auth: 'session',
    permission: 'users.manage',
    body: crearUsuarioSchema,
    audit: 'POST /api/users',
  },
  async ({ session, body }) => {
    const rol = await prisma.role.findUnique({ where: { id: body.roleId } })
    if (!rol) throw invalid('El rol indicado no existe')

    // Un rol sin permisos definidos crearia un usuario que no puede hacer
    // nada y nadie entenderia por que.
    if (!knownRoles().includes(rol.name)) {
      throw invalid(
        `El rol "${rol.name}" no tiene permisos definidos. Roles validos: ${knownRoles().join(', ')}`,
      )
    }

    // La sucursal la fija el servidor: un administrador da de alta personal en
    // SU sucursal. No se acepta branchId del cuerpo.
    const branchId = session.branchId

    const yaExiste = await prisma.user.findUnique({ where: { username: body.username } })
    if (yaExiste) throw conflict('Ya existe un usuario con ese nombre')

    const hash = await bcrypt.hash(body.password, 12)

    const creado = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: body.username,
          name: body.name,
          password: hash,
          roleId: body.roleId,
          branchId,
        },
        select: CAMPOS_PUBLICOS,
      })

      await audit(tx, {
        userId: session.userId,
        table: 'User',
        recordId: user.id,
        action: 'create',
        // El hash nunca entra en la bitacora.
        after: { id: user.id, username: user.username, name: user.name, rol: rol.name, branchId },
        origin: 'POST /api/users',
      })

      return user
    })

    return NextResponse.json(creado, { status: 201 })
  },
)
