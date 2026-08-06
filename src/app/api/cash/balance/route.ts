// src/app/api/cash/balance/route.ts
import { NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'

interface JwtPayload {
  userId: number
  role: string
  branchId: number
  iat?: number
  exp?: number
}

function getUserFromCookie(req: Request): { userId: number; branchId: number } {
  const cookieHeader = req.headers.get('cookie') || ''
  const match = cookieHeader.match(/token=([^;]+)/)
  if (!match) throw new Error('No token cookie')
  const token = match[1]
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  return { userId: decoded.userId, branchId: decoded.branchId }
}

export async function GET(req: Request) {
  let branchId: number
  try {
    ;({ branchId } = getUserFromCookie(req))
  } catch {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // Leer directamente el campo currentCash de la sucursal
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { currentCash: true },
  })
  if (!branch) {
    return NextResponse.json(
      { error: 'No se encontró la sucursal para calcular el saldo.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ balance: branch.currentCash })
}
