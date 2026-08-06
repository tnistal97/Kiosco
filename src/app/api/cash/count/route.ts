import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  // ✅ Esperar la promesa de cookies()
  const cookieStore = await cookies()
  const token = cookieStore.get('token')?.value

  if (!token) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { userId } = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number }
    const { amount, notes } = await req.json()

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { branchId: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    const cashCount = await prisma.cashCount.create({
      data: {
        userId,
        branchId: user.branchId,
        amount,
        notes,
      },
    })

    return NextResponse.json({ ok: true, cashCount })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
