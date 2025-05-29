import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt'

export async function GET() {
  const users = await prisma.user.findMany({
    include: { role: true, branch: true },
  });
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const data = await req.json();
  const hashed = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({
    data: { ...data, password: hashed },
  });
  return NextResponse.json(user);
}
