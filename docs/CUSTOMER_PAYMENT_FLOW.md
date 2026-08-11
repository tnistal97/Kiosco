# Cobro a un cliente

**Fase 4A.** Cómo se registra que un cliente pagó, qué pasa con la caja, y qué
papel se lleva.

---

## 1. Tres cosas, una transacción

Registrar un cobro escribe:

1. el **comprobante** (`CustomerPayment`),
2. el **movimiento del libro**, que baja el saldo,
3. el **movimiento de caja**, sólo si se cobró en efectivo.

Ocurren juntas o no ocurre ninguna. **No existe forma de crear un pago sin su
movimiento de cuenta**: es la misma transacción y no hay otro camino que escriba
`CustomerPayment`.

La reconciliación lo verifica desde el otro lado: _"todo cobro deja exactamente
un movimiento `PAYMENT`, por el mismo importe, en negativo"_.

---

## 2. Sólo el efectivo entra al cajón

Es la misma regla que gobierna la venta desde la Fase 3, aplicada al cobro:

| Medio                        | Baja el saldo | Entra a la caja |
| ---------------------------- | ------------- | --------------- |
| `CASH`                       | sí            | **sí**          |
| `TRANSFER`                   | sí            | no              |
| `DEBIT_CARD` / `CREDIT_CARD` | sí            | no              |
| `OTHER`                      | sí            | no              |

`ACCOUNT` **no figura**, y la base lo rechaza con un `CHECK`: pagar la cuenta con
la cuenta no significa nada —dejaría el saldo igual y generaría dos movimientos
que se cancelan—.

La pantalla lo dice **antes** de confirmar, no después:

> _Este pago baja la deuda pero NO entra a la caja: no es efectivo._

Sin ese aviso, un cobro por transferencia que no sube el cajón se lee como un
error al cerrar el turno.

### El turno

Un cobro **en efectivo** exige turno abierto, igual que una venta: la plata
entra al cajón y tiene que caer dentro de un arqueo. Un cobro por transferencia
**no lo exige**: cobrar por transferencia con la caja cerrada es una operación
legítima.

El movimiento de caja va con `type = 'customer_payment'`, que el resumen del
turno clasifica como **ingreso**. Es dinero que entró y no es una venta.

---

## 3. El vínculo con la caja es una clave foránea

`CashRegisterMovement.customerPaymentId`.

Existe por lo mismo que `saleId`, que la Fase 3 agregó para reemplazar el parseo
de _"Venta #123"_ sobre `description`. Sin esta columna, la reconciliación
tendría que buscar el número de comprobante con un `LIKE` dentro de la
descripción, y bastaría con cambiar cómo se redacta esa frase para que la
comprobación dejara de encontrar nada y **empezara a informar que todo cierra**.

Una reconciliación que falla en silencio es peor que no tenerla.

Un `description` es para leer en pantalla. Para unir tablas están las claves
foráneas.

---

## 4. Numeración: `RC-00000182`

Sale de una **secuencia de PostgreSQL**, igual que el número de orden de compra
y por el mismo motivo: `count() + 1` hace que dos personas cobrando en el mismo
segundo lean el mismo número, pidan el mismo número, y el índice único rechace a
una de las dos. Esa persona vería un error que no provocó.

`nextval()` es atómico y no bloquea. Se pide **fuera** de la transacción: no se
deshace con un `ROLLBACK`, así que pedirlo adentro no evitaría el hueco y sólo
alargaría la transacción.

Deja huecos, y está bien: es la etiqueta que se le da al cliente en el papel, no
un contador de cuántos cobros se hicieron. Para eso está `COUNT(*)`, que es
exacto.

Hay una prueba de concurrencia que registra diez cobros en paralelo y verifica
que los diez números sean distintos.

> **Cualquier cosa que escriba un `CustomerPayment` tiene que pedirle el número
> a la secuencia. También el seed.** La primera versión del seed de demostración
> escribía `RC-00000001` a mano y dejaba la secuencia en 1: el primer cobro real
> chocaba contra el índice único y quien estaba cobrando veía _"Ya existe un
> registro con esos datos"_ por algo que había hecho bien. Lo encontró la suite
> de extremo a extremo, que es el único lugar donde un número escrito a mano y
> una secuencia viva se cruzan.

---

## 5. Sobrepago

**Se permite, pero nunca en silencio.**

El cliente redondea para arriba, y prohibirlo obligaría a rechazar plata que ya
está sobre el mostrador. Lo que hay que evitar no es el caso: es que ocurra sin
que nadie lo haya visto.

Sin `aceptarSaldoAFavor`, el cobro se rechaza con 409 `PAYMENT_LEAVES_CREDIT`
diciendo cuánto sobra:

> _Juan Pérez debe $8.000 y el pago es de $10.000: quedan $2.000 a favor.
> Confirmá para registrarlo así._

Es el mismo mecanismo que la autorización de una diferencia de arqueo.

La comprobación se hace **dos veces**: antes de abrir la transacción —para poder
decir cuánto sobra sin haber tocado nada— y otra vez adentro, con el saldo real
y bajo el bloqueo de fila que tomó el libro. Sin la segunda, una venta a cuenta
que entrara entre la lectura y la transacción dejaría pasar un saldo a favor que
nadie confirmó.

El saldo negativo resultante se consume solo en la próxima compra a cuenta. Ver
[`CUSTOMER_ACCOUNT_LEDGER.md`](CUSTOMER_ACCOUNT_LEDGER.md), sección 5.

---

## 6. El comprobante

**No es una factura, y no lo dice en ninguna parte.** Este sistema todavía no
emite nada fiscal. El papel dice _"Comprobante de pago"_ y, debajo, _"Documento
no fiscal"_: llamarlo de otra forma haría que alguien lo presente donde no
corresponde.

Lleva:

|                    |                                             |
| ------------------ | ------------------------------------------- |
| Comercio           | nombre, dirección y teléfono de la sucursal |
| Número             | `RC-00000182`                               |
| Fecha y hora       |                                             |
| Cliente            | nombre y documento, si lo tiene             |
| Importe            |                                             |
| Medio              | _Efectivo_, _Transferencia_…                |
| **Saldo anterior** |                                             |
| **Saldo nuevo**    |                                             |
| Quién atendió      |                                             |

Los dos saldos son lo que convierte el papel en algo útil: el cliente se lleva
escrito de cuánto venía y cuánto le queda, y no tiene que confiar en la memoria
de nadie.

La impresión usa el diálogo del navegador (`window.print()`) y no una
biblioteca: cualquier impresora que el local tenga configurada ya funciona. Los
controles llevan `print:hidden`, así que el papel sale sin botones dibujados
encima.

**Es reimprimible a propósito.** El papel se pierde, y quien reclama _"yo te
pagué el martes"_ tiene que poder recibir otra copia idéntica. Que sea idéntica
está garantizado por la inmutabilidad de `CustomerPayment`, no por una
convención: hay un disparador que impide el `UPDATE` y el `DELETE`.

---

## 7. Ajuste manual: lo que **no** es un cobro

`POST /api/clients/:id/ajuste`, con `accounts.adjust`.

Escribe un movimiento que **no responde a ninguna venta ni a ningún cobro**. Es
la herramienta para cargar la deuda anterior a la puesta en marcha del sistema,
para corregir una venta cargada dos veces, o para dejar un saldo a favor
inicial.

Tres cosas lo separan de un cobro:

1. **Se declara el delta, no el saldo final.** _"Sumale 2.000 por deuda anterior
   a la migración"_ deja un movimiento que se entiende dentro de dos años;
   _"poneme el saldo en 7.000"_ no dice de dónde salieron los 2.000 ni contra
   qué saldo se estaba operando.
2. **El motivo es obligatorio**, en el esquema, en el servicio y en un `CHECK`
   de la base.
3. **No genera movimiento de caja ni comprobante.** No entró plata.

La pantalla pide _"cuánto"_ y _"en qué dirección"_ por separado en vez de un
importe con signo: un `-2000` mal copiado es un ajuste al revés.

Y avisa lo que es:

> _Un ajuste escribe un movimiento que no responde a ninguna venta ni a ningún
> pago. Para registrar plata que entró, usá **Registrar pago**._

---

## 8. Lo que comprueba la reconciliación

Bajo **Cobros a clientes**, tres reglas:

1. Cada `CustomerPayment` tiene **un** movimiento `PAYMENT`, y vale `−amount`.
2. Si se cobró en efectivo, hay movimiento de caja por el mismo importe.
3. Si **no** se cobró en efectivo, **no** hay movimiento de caja.

La tercera es tan importante como la segunda: una transferencia que aumentara el
efectivo físico rompería el arqueo del turno sin que nada más lo notara.

Las tres tienen su prueba de inyección: se rompe el estado con SQL directo y se
verifica que la comprobación lo encuentre con el importe exacto.

---

## 9. Documentos relacionados

- [`CUSTOMER_ACCOUNT_LEDGER.md`](CUSTOMER_ACCOUNT_LEDGER.md) — el libro
- [`CREDIT_POLICY.md`](CREDIT_POLICY.md) — quién puede cobrar y quién ajustar
- [`CASH_SHIFT_MODEL.md`](CASH_SHIFT_MODEL.md) — el turno al que entra el efectivo
- [`PHASE3_RECONCILIATION.md`](PHASE3_RECONCILIATION.md) — las trece comprobaciones
