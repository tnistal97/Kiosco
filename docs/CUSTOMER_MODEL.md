# Modelo de cliente

**Fase 4A.** Qué es un cliente en este sistema, y sobre todo qué **no** se le
exige.

---

## 1. Lo único obligatorio es el nombre

```
Juan Pérez
```

Eso es un cliente válido. Sin DNI, sin CUIT, sin teléfono, sin dirección.

Es la misma decisión que se tomó con `Supplier` en la Fase 3C, y por el mismo
motivo: un almacén de barrio conoce _"Juan, el del taller"_ y a veces un
teléfono. Exigir un documento obligaría a inventarlo, y **un documento inventado
es peor que ninguno porque parece un dato**: alguien lo va a usar para buscar,
para cotejar o para reclamar.

La base lo hace cumplir con un `CHECK` que rechaza un nombre vacío o de sólo
espacios. Lo único que se pide tiene que significar algo.

---

## 2. El cliente es de una sucursal

A diferencia de los proveedores —que son del negocio— los clientes se cargan por
sucursal. La cuenta corriente es una relación de confianza entre **un comercio**
y una persona, y dos locales del mismo dueño no necesariamente le fían a la
misma gente.

Todas las consultas filtran por `branchId`, y un cliente de otra sucursal se
comporta como si no existiera: se responde 404 sin confirmar que exista en otro
lado, igual que con productos y ventas.

El día que haga falta un cliente compartido, se agrega. Empezar compartiendo
obligaría a separar después, que es el cambio caro.

---

## 3. Los tres estados que no son el mismo

| Campo             | Pregunta que responde         |
| ----------------- | ----------------------------- |
| `isActive`        | ¿Existe todavía como cliente? |
| `isCreditEnabled` | ¿Se le puede fiar **hoy**?    |
| `creditLimit`     | ¿Hasta cuánto?                |

Son tres preguntas distintas y tienen tres columnas distintas.

Un cliente que se atrasó puede seguir comprando de contado: darlo de baja para
cortarle el fiado lo sacaría del sistema entero, y con él su historial. Por eso
`isCreditEnabled` existe aparte, y por eso tiene su propio endpoint
(`PATCH /api/clients/:id/fiado`) y no es un campo más del formulario de edición:
cortarle el fiado a alguien tiene efecto inmediato sobre la próxima venta, y eso
tiene que ser una decisión y no una casilla que quedó marcada de antes.

### `creditLimit`: NULL y 0 no son lo mismo

```
NULL   sin límite configurado. Nadie decidió cuánto se le fía.
0      no se le fía. Alguien decidió que su límite es cero.
```

Por eso la columna es nullable y **no** tiene `@default(0)`: con cero por
omisión, todo cliente nuevo nacería con el fiado prohibido sin que nadie lo
hubiera dispuesto. El formulario lo dice con esas palabras, y la pantalla de
listado muestra _"Sin límite"_ en vez de un guion.

Un límite negativo no significa nada, y la base lo rechaza.

---

## 4. Baja, no borrado

Un cliente con ventas, movimientos de cuenta o pagos **no se borra**: se da de
baja. `DELETE /api/clients/:id` responde 409 `CLIENT_HAS_HISTORY` nombrando qué
lo retiene —_"tiene 3 venta(s), 5 movimiento(s) de cuenta"_— porque un _"no se
puede"_ sin motivo obliga a probar de a una las tres cosas.

El caso para el que el borrado sirve es el único que queda: alguien tipeó mal un
nombre en el alta rápida y quiere que desaparezca en vez de convivir con un
cliente mal escrito y dado de baja para siempre.

`Sale.clientId` es `ON DELETE RESTRICT` y **no** el `SetNull` que Prisma pone
por omisión en una relación opcional. Con `SetNull`, borrar un cliente dejaría
sus ventas en pie pero sin dueño, y una venta que decía _"de Juan"_ pasaría a
decir _"del mostrador"_ sin que nadie se entere.

**Dar de baja a alguien que debe plata no se impide.** Pasa —el cliente se mudó
y quedó debiendo— y prohibirlo obligaría a dejarlo activo para siempre o a
perdonarle la deuda para poder archivarlo. Lo que sí se hace es decirlo: la
respuesta lleva `deudaPendiente` y el mensaje termina en _"Queda debiendo
$17.000"_.

---

## 5. Nombres repetidos

Dos personas se pueden llamar igual, y un almacén que tiene dos _"Juan Pérez"_
tiene que poder cargar a los dos. **No hay índice único sobre el nombre.**

Lo que sí hay es una advertencia convertida en conflicto: el alta y la edición
rechazan un nombre que ya exista en la sucursal, con un mensaje que sugiere qué
agregar para distinguirlos. Es contra el tipeo duplicado por accidente, no
contra la homonimia.

**El alta rápida la saltea a propósito.** Quien está cobrando no puede parar a
resolver si este Juan Pérez es el mismo Juan Pérez. El cliente queda cargado y
la duplicación, si la hubo, se resuelve después desde la ficha, que es donde hay
tiempo.

---

## 6. Venta sin cliente

`Sale.clientId` es **nullable, y va a seguir siéndolo**.

`NULL` significa **venta al mostrador**, no _"cliente desconocido"_. Un almacén
no le pide el nombre a quien compra un paquete de yerba, y obligar a identificar
a todo comprador convertiría la venta rápida en un trámite.

Todas las ventas anteriores a esta fase quedan en `NULL` y no se les inventa un
cliente: inventarlo sería afirmar que alguien compró algo que no se sabe si
compró.

La única excepción la impone el servidor: **una venta con parte a cuenta exige
cliente**, porque una deuda sin deudor no se puede cobrar. Se rechaza con 400
`ACCOUNT_SALE_NEEDS_CLIENT`, y la reconciliación tiene una regla que busca ese
caso por si alguna vez se cuela por otro camino.

---

## 7. Migración histórica

No se inventó nada.

- Las ventas anteriores quedan con `clientId = NULL`.
- El saldo inicial de **todos** los clientes nuevos es `0`.
- No hay deuda histórica que migrar: el sistema anterior no tenía cuenta
  corriente real. Lo que sí existe es el camino para cargarla, cliente por
  cliente, con `accounts.adjust` y un motivo escrito.

La migración `phase4_clients` crea la tabla y nada más. `phase4_sale_client`
agrega la columna nullable. Ninguna de las dos toca una fila existente.

---

## 8. Búsqueda y rendimiento

Cuatro índices, uno por consulta real:

| Índice                       | Para qué                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| `(branchId, isActive, name)` | El listado y su orden                                           |
| `(branchId, balance)`        | Los filtros _"con deuda"_ y _"con saldo a favor"_, y el ranking |
| `(branchId, phone)`          | Buscar por teléfono                                             |
| `(branchId, document)`       | Buscar por documento                                            |

**La búsqueda por nombre parcial (`ILIKE '%pere%'`) no usa ninguno de ellos:**
ningún btree sirve para un comodín a la izquierda. Se midió antes de decidir —
ver el informe de la fase— y a diez mil clientes el recorrido secuencial tarda
menos que lo que cuesta mantener un índice de trigramas.

El día que un comercio tenga cien mil clientes, la respuesta es `pg_trgm` con un
índice GIN. Está escrito acá y en la migración para no tener que volver a
averiguarlo.

Dos decisiones que sí importan al volumen:

- **El listado pagina en el servidor.** Con diez mil clientes, traerlos para
  filtrar en el navegador no es una opción.
- **La búsqueda del mostrador exige texto.** `/api/clients/buscar` rechaza la
  petición sin `q` y devuelve como mucho veinte. No existe forma de pedirle
  _"todos los clientes"_ desde el punto de venta.
- **La última compra y la última actividad vienen en la misma consulta**, con un
  `select` anidado de un elemento. Resolverlas después, de a una, sería una
  consulta por fila: el N+1 que la paginación no arregla.

---

## 9. Documentos relacionados

- [`CUSTOMER_ACCOUNT_LEDGER.md`](CUSTOMER_ACCOUNT_LEDGER.md) — el libro y sus invariantes
- [`CREDIT_POLICY.md`](CREDIT_POLICY.md) — límite, override y fiado cortado
- [`CUSTOMER_PAYMENT_FLOW.md`](CUSTOMER_PAYMENT_FLOW.md) — el cobro y el comprobante
- [`SUPPLIER_MODEL.md`](SUPPLIER_MODEL.md) — el modelo del que este copia su criterio
