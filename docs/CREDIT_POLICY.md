# Política de crédito

**Fase 4A.** Cuándo se le fía a alguien, hasta cuánto, y quién puede decidir
que esta vez no importa.

---

## 1. Fiar exige tres cosas

Una venta con una línea `ACCOUNT` sólo entra si se cumplen las tres:

| Condición                           | Error si falla                  |
| ----------------------------------- | ------------------------------- |
| Hay un cliente                      | 400 `ACCOUNT_SALE_NEEDS_CLIENT` |
| Quien vende tiene `accounts.charge` | 403                             |
| El cliente admite ese cargo         | 409, con tres códigos distintos |

Las tres las impone el **servidor**. La pantalla las adelanta —el botón de
cobrar se frena y el selector de cliente se abre solo— pero eso es para que el
cajero no descubra el rechazo con el cliente enfrente, no para reemplazar la
comprobación.

---

## 2. Las tres razones por las que un cargo se rechaza

Tres códigos distintos porque son tres problemas distintos, con tres soluciones
distintas:

| Código                   | Qué pasó                     | Qué hacer                          |
| ------------------------ | ---------------------------- | ---------------------------------- |
| `CLIENT_INACTIVE`        | El cliente está dado de baja | Reactivarlo                        |
| `CLIENT_CREDIT_DISABLED` | Tiene el fiado cortado       | Habilitárselo, si corresponde      |
| `CREDIT_LIMIT_EXCEEDED`  | Se pasa del límite           | Autorizar, o cobrar más de contado |

Un _"no se puede"_ genérico obligaría a adivinar cuál de los tres es.

El mensaje del tercero dice **los tres números**:

> _Juan Pérez llegaría a $53.000 y su límite es $50.000: se pasa por $3.000._

---

## 3. El límite se comprueba dentro de la transacción

No antes. En la **misma sentencia** que mueve el saldo:

```sql
UPDATE "Client" SET "balance" = "balance" + $delta
 WHERE … AND ("creditLimit" IS NULL OR "balance" + $delta <= "creditLimit")
```

Es lo que impide que dos cajas simultáneas se pasen entre las dos. Ver
[`CUSTOMER_ACCOUNT_LEDGER.md`](CUSTOMER_ACCOUNT_LEDGER.md), sección 3.

`GET /api/clients/:id/credito?monto=…` existe para **mostrar** el resultado
antes de confirmar, con los cinco números que hacen falta para entenderlo:

```
Juan Pérez

Saldo actual:       $23.000
Compra a cuenta:    $12.000
Saldo resultante:   $35.000
Límite:             $50.000
Disponible después: $15.000
```

Es una **previsualización, no una reserva**. Entre esa consulta y el cobro puede
entrar otra venta del mismo cliente en otra caja, y por eso la comprobación que
decide sigue estando adentro. Esto es para que la persona entienda; aquello es
para que el número no se rompa.

El cálculo lo hace el servidor, con las mismas tres condiciones que aplica el
libro. Replicarlas en el navegador garantizaría que algún día digan cosas
distintas.

---

## 4. El límite no frena un pago

`applyAccountMovement` sólo comprueba la política de crédito cuando el delta es
**positivo**. Un pago, una anulación o un ajuste que reduce la deuda pasan
siempre.

Si el límite frenara los pagos, un cliente que se pasó del límite —porque
alguien autorizó el exceso— no podría salir de ahí. Hay una prueba que lo
verifica.

---

## 5. Override: `accounts.overrideLimit`

El caso es real: el cliente de siempre está $2.000 por encima del límite y el
dueño dice _"dale igual"_. Sin un mecanismo, eso termina siendo un límite que
nadie configura porque estorba, y **un límite que nadie configura no protege
nada**.

Lo que se exige cuando se usa:

1. **El permiso.** Pedir la autorización sin tenerlo es un **403**, no algo que
   se ignore en silencio.
2. **Un acto explícito.** Tener el permiso no alcanza: sin
   `autorizarExcesoDeCredito`, el administrador también recibe el 409. Hay una
   prueba para cada mitad.
3. **Quién.** `CustomerAccountMovement.authorizedById`, en la **fila del libro**
   y no sólo en la bitácora. Quien lee el extracto tiene que poder ver que esa
   deuda se tomó por encima del límite y quién lo permitió, sin cruzar dos
   tablas.
4. **Los cuatro números.** Importe, saldo anterior, saldo posterior y límite
   quedan en la misma fila.

En la pantalla no es una casilla escondida: **aparece sólo cuando de verdad hace
falta**, dice que va a quedar registrada con el nombre de quien la marca, y sólo
la ve quien tiene el permiso. Quien no lo tiene ve por qué no se puede y a quién
pedírselo.

---

## 6. El fiado cortado no es un límite

`isCreditEnabled = false` **no lo saltea el override**, y es deliberado.

Pasarse del límite es autorizar una operación que existe, con su venta detrás.
Cortarle el fiado a alguien es una **decisión**, no un tope: reabrirlo es
cambiar esa política, no saltearla en una venta suelta. Hay una prueba que
comprueba que el override no desbloquea a un cliente con el fiado cortado.

El cliente con el fiado cortado **sigue comprando de contado**. Es todo el punto
de que sea una columna aparte de `isActive`.

---

## 7. Quién puede qué

| Permiso                  | Quién lo tiene                                  | Qué habilita             |
| ------------------------ | ----------------------------------------------- | ------------------------ |
| `accounts.charge`        | Dueño, admin, encargado, supervisor, **cajero** | Fiar                     |
| `accounts.payment`       | Los mismos                                      | Cobrar                   |
| `accounts.adjust`        | Dueño, admin, encargado                         | Corregir un saldo a mano |
| `accounts.overrideLimit` | Dueño, admin, encargado, **supervisor**         | Pasar el límite          |

**El cajero fía y cobra.** Fiarle a un cliente conocido es una operación normal
de un almacén de barrio, no una excepción administrativa.

**El cajero no ajusta.** Es la separación que da sentido a todo el módulo: quien
cobra no puede bajarle la deuda a nadie sin que se note. Con `accounts.adjust`
se escribe un movimiento que no responde a ninguna venta ni a ningún cobro, y
por eso el motivo es obligatorio en los tres lugares —el esquema, el servicio y
una restricción `CHECK`—.

**El supervisor autoriza pero no ajusta.** Es el escalón que hoy obliga a llamar
al dueño por teléfono; darle además el ajuste manual sería darle la capacidad de
perdonar deudas.

**Compras y el repositor no tienen nada de esto.** El repositor no vende ni
cobra: no hay ninguna operación suya que necesite saber quién debe cuánto, y el
saldo de una persona es información suya. Compras negocia con proveedores, que
es el otro lado del mostrador; separar quién compra de quién cobra ya es el
control básico del rol.

**El auditor lee y no escribe**, incluida la cuenta corriente.

---

## 8. Documentos relacionados

- [`CUSTOMER_ACCOUNT_LEDGER.md`](CUSTOMER_ACCOUNT_LEDGER.md) — el libro y la sentencia que comprueba el límite
- [`CUSTOMER_MODEL.md`](CUSTOMER_MODEL.md) — `NULL` vs `0` en el límite
- [`PERMISSIONS_MATRIX.md`](PERMISSIONS_MATRIX.md) — la matriz completa
