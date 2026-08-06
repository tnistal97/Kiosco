/**
 * Emision y verificacion del token de sesion.
 *
 * Usa `jose` en lugar de `jsonwebtoken` por una razon concreta: el middleware
 * corre en el runtime Edge, donde `jsonwebtoken` (que depende de `crypto` de
 * Node) no funciona. Con una sola libreria valida en ambos runtimes no hacen
 * falta dos implementaciones de lo mismo.
 */

import { SignJWT, jwtVerify } from 'jose'

export interface TokenClaims {
  userId: number
  branchId: number
  role: string
  /** sessionVersion con la que se emitio. Permite revocar sesiones. */
  sv: number
}

export const SESSION_COOKIE = 'token'
export const SESSION_TTL_SECONDS = 60 * 60 * 12 // 12 h: una jornada de almacen

const MIN_SECRET_LENGTH = 32

/**
 * Lee el secreto de forma perezosa (no al importar el modulo) para que el
 * build no falle, pero rechaza secretos debiles en tiempo de ejecucion.
 *
 * El valor `change-me` que quedo en el servidor de produccion tiene 9
 * caracteres: con esta comprobacion la aplicacion se niega a emitir tokens
 * en vez de emitirlos falsificables.
 */
function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET ausente o demasiado corto (minimo ${MIN_SECRET_LENGTH} caracteres). ` +
        'Generar uno con: openssl rand -base64 48',
    )
  }
  return new TextEncoder().encode(secret)
}

export async function signSessionToken(claims: TokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey())
}

/**
 * Verifica firma y vencimiento. NO consulta la base: sirve tanto en Node como
 * en Edge. La comprobacion de usuario activo y de sessionVersion vive en
 * `getSession`, que si tiene acceso a la base.
 *
 * Devuelve null ante cualquier problema; nunca lanza por token invalido.
 */
export async function verifySessionToken(token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] })

    const { userId, branchId, role, sv } = payload as Record<string, unknown>
    if (
      typeof userId !== 'number' ||
      typeof branchId !== 'number' ||
      typeof role !== 'string' ||
      typeof sv !== 'number'
    ) {
      return null
    }

    return { userId, branchId, role, sv }
  } catch {
    return null
  }
}

/** Extrae el token de la cabecera Cookie de una peticion. */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) return rest.join('=') || null
  }
  return null
}

/** Opciones de la cookie de sesion. Un solo lugar para no divergir. */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}
