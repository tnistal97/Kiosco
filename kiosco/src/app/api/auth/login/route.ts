import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

export async function POST(req: Request) {
  const { username, password } = await req.json()

  const user = await prisma.user.findFirst({
    where: { username },
    include: { role: true, branch: true },
  })

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 })
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role.name, branchId: user.branchId },
    process.env.JWT_SECRET!,
    { expiresIn: '1d' }
  )

  return NextResponse.json({ token })
}
