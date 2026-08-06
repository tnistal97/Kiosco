import { NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import prisma from '@/lib/prisma'

interface JwtPayload {
  userId: number
  role: string
  branchId: number
  iat?: number
  exp?: number
}

// Helper para leer/verificar el JWT desde la cookie
function getUserFromCookie(req: Request): { userId: number; branchId: number } {
  const cookieHeader = req.headers.get('cookie') || ''
  const match = cookieHeader.match(/token=([^;]+)/)
  if (!match) throw new Error('No token cookie')
  const token = match[1]
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  return { userId: decoded.userId, branchId: decoded.branchId }
}

// GET: /api/audit
export async function GET(req: Request) {
  try {
    // 1️⃣ Verificar JWT y obtener branchId
    let branchId: number
    try {
      const { branchId: userBranchId } = getUserFromCookie(req)
      branchId = userBranchId
    } catch {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // 2️⃣ Traer solo los logs de la sucursal del usuario
    const logs = await prisma.auditLog.findMany({
      where: {
        user: {
          branchId,
        },
      },
      orderBy: { timestamp: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    return NextResponse.json(logs)
  } catch (err) {
    console.error('[API AUDIT] Error:', err)
    return NextResponse.json(
      { error: 'Error al obtener los registros de auditoría' },
      { status: 500 }
    )
  }
}
