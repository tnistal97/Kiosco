import { NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import prisma from '@/lib/prisma'

export async function POST(req: Request) {
  const token = req.headers.get('cookie')?.split('token=')[1]?.split(';')[0]

  if (!token) {
    return NextResponse.json({ valid: false }, { status: 401 })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number }

    // Buscamos el usuario y su rol (solo los campos necesarios)
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        role: {
          select: {
            name: true, // Así obtenemos el nombre del rol (ej. "admin")
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ valid: false }, { status: 401 })
    }


    console.log({
      valid: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role.name, // 👈
      },
    })
    console.log('queee')
    // Devolvemos el user con role.name
    return NextResponse.json({
      valid: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role.name, // 👈
      },
    })
  } catch {
    return NextResponse.json({ valid: false }, { status: 401 })
  }
}
