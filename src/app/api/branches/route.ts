// src/app/api/branches/route.ts
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JwtPayload = {
  userId: number
  role: string
  branchId: number
  iat?: number
  exp?: number
}

async function getAuth(): Promise<{ userId: number; branchId: number; role: string }> {
  const store = await cookies()
  const token = store.get('token')?.value
  if (!token) throw new Error('no_token')

  let decoded: JwtPayload
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  } catch (e: any) {
    if (e?.name === 'TokenExpiredError') throw new Error('token_expired')
    if (e?.name === 'JsonWebTokenError') throw new Error('token_invalid')
    throw new Error('token_verify_failed')
  }
  if (!decoded?.userId || !decoded?.branchId || !decoded?.role) throw new Error('token_missing_claims')
  return { userId: decoded.userId, branchId: decoded.branchId, role: decoded.role }
}

// GET: admin => todas las sucursales; otros => solo su sucursal
export async function GET() {
  try {
    let userId: number, branchId: number, role: string
    try {
      ({ userId, branchId, role } = await getAuth())
    } catch (e: any) {
      return NextResponse.json({ error: 'No autenticado', reason: e?.message }, { status: 401 })
    }

    const isAdmin = role === 'admin'

    if (isAdmin) {
      const all = await prisma.branch.findMany({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          address: true,
          email: true,
          phone: true,
          createdAt: true,
          currentCash: true,
        },
      })
      return NextResponse.json(all)
    } else {
      const one = await prisma.branch.findUnique({
        where: { id: branchId },
        select: {
          id: true,
          name: true,
          address: true,
          email: true,
          phone: true,
          createdAt: true,
          currentCash: true,
        },
      })
      return NextResponse.json(one)
    }
  } catch (error) {
    console.error('GET /branches error:', error)
    return NextResponse.json({ error: 'Error fetching branches' }, { status: 500 })
  }
}

// POST: crear sucursal (solo admin)
export async function POST(req: Request) {
  try {
    let userId: number, role: string
    try {
      ({ userId, role } = await getAuth())
    } catch (e: any) {
      return NextResponse.json({ error: 'No autenticado', reason: e?.message }, { status: 401 })
    }
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { name, address, email, phone } = body || {}
    if (!name) {
      return NextResponse.json({ error: 'Falta name' }, { status: 400 })
    }

    const branch = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.branch.create({
        data: { name: String(name), address: address ?? null, email: email ?? null, phone: phone ?? null },
      })
      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'Branch',
          recordId: created.id,
          actionType: 'create',
          changes: { before: null, after: created },
          origin: 'api-branches-route',
        },
      })
      return created
    })

    return NextResponse.json(branch, { status: 201 })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Nombre de sucursal duplicado' }, { status: 409 })
    }
    console.error('POST /branches error:', error)
    return NextResponse.json({ error: 'Error creating branch' }, { status: 500 })
  }
}

// PATCH: actualizar sucursal por id (solo admin)
// Body: { id: number, name?, address?, email?, phone? }
export async function PATCH(req: Request) {
  try {
    let userId: number, role: string
    try {
      ({ userId, role } = await getAuth())
    } catch (e: any) {
      return NextResponse.json({ error: 'No autenticado', reason: e?.message }, { status: 401 })
    }
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { id, name, address, email, phone } = body || {}
    if (!id) {
      return NextResponse.json({ error: 'Falta id' }, { status: 400 })
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const before = await tx.branch.findUnique({ where: { id: Number(id) } })
      const result = await tx.branch.update({
        where: { id: Number(id) },
        data: {
          ...(name !== undefined ? { name: String(name) } : {}),
          ...(address !== undefined ? { address: address ?? null } : {}),
          ...(email !== undefined ? { email: email ?? null } : {}),
          ...(phone !== undefined ? { phone: phone ?? null } : {}),
        },
        select: {
          id: true,
          name: true,
          address: true,
          email: true,
          phone: true,
          createdAt: true,
          currentCash: true,
        },
      })
      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'Branch',
          recordId: result.id,
          actionType: 'update',
          changes: { before, after: result },
          origin: 'api-branches-route',
        },
      })
      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('PATCH /branches error:', error)
    return NextResponse.json({ error: 'Error updating branch' }, { status: 500 })
  }
}

// DELETE: eliminar sucursal por id (solo admin)
// Body: { id: number }
export async function DELETE(req: Request) {
  try {
    let userId: number, role: string
    try {
      ({ userId, role } = await getAuth())
    } catch (e: any) {
      return NextResponse.json({ error: 'No autenticado', reason: e?.message }, { status: 401 })
    }
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { id } = body || {}
    if (!id) {
      return NextResponse.json({ error: 'Falta id' }, { status: 400 })
    }

    try {
      const deleted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const before = await tx.branch.findUnique({ where: { id: Number(id) } })
        const res = await tx.branch.delete({ where: { id: Number(id) } })
        await tx.auditLog.create({
          data: {
            userId,
            tableName: 'Branch',
            recordId: res.id,
            actionType: 'delete',
            changes: { before, after: null },
            origin: 'api-branches-route',
          },
        })
        return res
      })
      return NextResponse.json({ ok: true, deletedId: deleted.id })
    } catch (e: any) {
      if (e?.code === 'P2003') {
        return NextResponse.json(
          { error: 'No se puede borrar: hay registros relacionados (ventas/usuarios/productos/etc.)' },
          { status: 409 }
        )
      }
      throw e
    }
  } catch (error) {
    console.error('DELETE /branches error:', error)
    return NextResponse.json({ error: 'Error deleting branch' }, { status: 500 })
  }
}
