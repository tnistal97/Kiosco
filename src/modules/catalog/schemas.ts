/**
 * Validacion de entrada de los catalogos auxiliares: sucursales y categorias.
 *
 * Van juntos a proposito. Son CRUD sin reglas de negocio propias, y separarlos
 * en dos modulos de un archivo cada uno seria ceremonia sin utilidad.
 *
 * PROVEEDORES YA NO ESTA ACA. Este archivo decia, desde la Fase 1: "cuando
 * proveedores crezca --con condiciones de compra, listas de precios y cuenta
 * corriente-- se muda a su propio modulo". Con ordenes de compra y
 * recepciones, creció: vive en `@/modules/suppliers/schemas`.
 */

import { z } from 'zod'
import { idSchema, optionalText, shortText } from '@/server/http/validate'

const emailSchema = z.string().trim().email('Correo invalido').max(200).nullable().optional()

// --------------------------------------------------------------- sucursales

export const crearSucursalSchema = z
  .object({
    name: shortText(120),
    address: optionalText(300),
    email: emailSchema,
    phone: optionalText(50),
  })
  .strict()

export const editarSucursalSchema = z
  .object({
    id: idSchema,
    name: shortText(120).optional(),
    address: optionalText(300),
    email: emailSchema,
    phone: optionalText(50),
  })
  .strict()

// --------------------------------------------------------------- categorias

export const crearCategoriaSchema = z.object({ name: shortText(80) }).strict()

export type CrearSucursalInput = z.infer<typeof crearSucursalSchema>
export type EditarSucursalInput = z.infer<typeof editarSucursalSchema>
export type CrearCategoriaInput = z.infer<typeof crearCategoriaSchema>
