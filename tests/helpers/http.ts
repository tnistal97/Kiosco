/**
 * Invocacion directa de los route handlers.
 *
 * No se levanta un servidor HTTP: se importa el handler y se lo llama con un
 * Request construido a mano. Es mas rapido, no depende de puertos libres y
 * permite probar la autorizacion del handler AISLADA del middleware, que es
 * justamente lo que hay que garantizar (el middleware no puede ser la unica
 * capa de defensa).
 */

import { NextRequest } from 'next/server'
import { signSessionToken, SESSION_COOKIE } from '@/server/auth/token'
import type { TestUser } from './db'

const BASE = 'http://localhost:3000'

export type RouteHandler = (
  req: NextRequest,
  args?: { params?: Promise<Record<string, string>> },
) => Promise<Response>

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Cookie completa, p. ej. `token=eyJ...`. Omitir = visitante anonimo. */
  cookie?: string | null
  params?: Record<string, string>
  /** Cuerpo crudo, para probar JSON mal formado. */
  rawBody?: string
}

export function buildRequest(path: string, options: CallOptions = {}): NextRequest {
  const { method = 'GET', body, cookie, rawBody } = options

  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (body !== undefined || rawBody !== undefined) {
    headers.set('content-type', 'application/json')
  }

  return new NextRequest(new URL(path, BASE), {
    method,
    headers,
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })
}

export interface CallResult<T = unknown> {
  status: number
  body: T
  /** Cuerpo sin parsear. Sirve para buscar hashes con expresiones regulares. */
  text: string
  headers: Headers
}

export async function call<T = unknown>(
  route: RouteHandler,
  path: string,
  options: CallOptions = {},
): Promise<CallResult<T>> {
  const req = buildRequest(path, options)
  const args = options.params ? { params: Promise.resolve(options.params) } : undefined

  const res = await route(req, args)
  const text = await res.text()

  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  return { status: res.status, body: parsed as T, text, headers: res.headers }
}

/** Cookie de sesion valida para un usuario del fixture. */
export async function sessionCookie(user: TestUser): Promise<string> {
  const token = await signSessionToken({
    userId: user.id,
    branchId: user.branchId,
    role: user.role,
    sv: user.sessionVersion,
  })
  return `${SESSION_COOKIE}=${token}`
}

/** Cookie con claims arbitrarios, para probar tokens manipulados o vencidos. */
export async function rawCookie(token: string): Promise<string> {
  return `${SESSION_COOKIE}=${token}`
}
