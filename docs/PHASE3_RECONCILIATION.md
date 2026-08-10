# Reconciliación: demostrar que el sistema cierra

## Qué significa "cierra"

No que el panel se vea bien. Que las cifras se puedan **derivar por otro
camino** y den lo mismo.

Un dashboard puede mostrar $93.250 de recaudación porque sumó mal y nadie lo
nota durante dos años. Una invariante no: dice que el total de una venta tiene
que ser exactamente la suma de sus pagos, y si un día no lo es, hay una fila con
nombre y apellido.

## Las dos reglas del motor

### 1. No se reusa el código que escribe

Cada comprobación es **SQL sobre las tablas**. El servicio suma con `Decimal.js`
en JavaScript; la reconciliación suma con `SUM()` en PostgreSQL.

Es el punto entero. Una prueba que llama a la misma función que escribió el dato
no comprueba nada: comprueba que la función es igual a sí misma. Si los dos
caminos se equivocan igual, es porque son el mismo camino.

### 2. Sólo se lee

No hay un `UPDATE` en todo `src/modules/integrity/`. Encontrar una diferencia y
arreglarla sola es la peor respuesta posible: tapa el síntoma, **borra la
evidencia** y deja intacto el error de origen para que vuelva a pasar. Se
informa, y decide una persona.

## Las nueve comprobaciones

| Comprobación       | Regla                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- |
| **Ventas**         | `total = Σ round(precio × cantidad, 2)`                                                       |
| **Pagos**          | `total = Σ pagos`, y toda venta tiene pagos                                                   |
| **Venta y caja**   | por medio de pago: `movimiento = cobrado`                                                     |
| **Anulaciones**    | por medio: `venta + reversión = 0`                                                            |
| **Turnos de caja** | `esperado = inicial + efectivo del turno`; `diferencia = contado − esperado`                  |
| **Inventario**     | `stock = Σ libro`; `previo + delta = resultante`; cada fila empieza donde terminó la anterior |
| **Compras**        | `recibido = Σ recepciones`, nunca `> pedido`; estado derivado; `total = Σ pedido × costo`     |
| **Recepciones**    | `stock = recibido × unidades por bulto`; toda recepción tiene su movimiento                   |
| **Costos**         | `Product.cost` = último evento del historial; el historial encadena                           |

### Por qué la continuidad del libro necesita tres reglas y no dos

```
1. Σ movimientos = BranchStock.quantity      el saldo cierra
2. previo + delta = resultante               cada fila cierra sola
3. previo = resultante del anterior          no falta ninguna fila
```

La tercera es la que detecta una fila **borrada del medio** aunque alguien haya
ajustado `BranchStock` para taparlo: el saldo cerraría, cada fila sobreviviente
sería coherente consigo misma, y sólo la cadena vería el hueco.

**El límite honesto:** borrar el **último** movimiento de un producto y ajustar
el saldo a mano **no lo detecta ninguna de las tres**. No queda hueco —no hay
fila posterior que lo delate— ni descuadre. Contra ese caso protege otra cosa:
el disparador que impide `UPDATE` y `DELETE` sobre el libro, que hay que
desactivar a propósito para llegar a ese estado. Hay una prueba que documenta
exactamente esto, porque decirlo vale más que fingir lo contrario.

Hay además un `CHECK` para la 2. Comprobarlas igual no es desconfianza: una
restauración desde un respaldo puede traer datos escritos por una versión
anterior de esas defensas.

## La transferencia no aumenta el efectivo

Es la invariante que más se ve en el mostrador. Una venta de $30.000:

```
$10.000 CASH       →  movimiento CASH      +10.000   entra al cajón
$20.000 TRANSFER   →  movimiento TRANSFER  +20.000   NO entra al cajón
```

El esperado del turno suma sólo los movimientos con `paymentMethod = 'CASH'`. La
comprobación compara **medio por medio**: por cada venta, lo que dice el pago y
lo que dice el movimiento tienen que coincidir en cada forma de cobro. El `FULL
OUTER JOIN` no es adorno — encuentra tanto el pago sin movimiento como el
movimiento sin pago, que son dos errores distintos.

## La regla del último evento de costo

Ésta era la única ambigüedad real del modelo, y ahora tiene una respuesta:

> `Product.cost` es el `newCost` de la fila de `ProductCostHistory` con el **`id`
> más alto** de ese producto.

No "la última recepción". No "el último cambio manual". **El último evento**,
venga de donde venga.

| Lunes                      | Martes                     | Costo      |
| -------------------------- | -------------------------- | ---------- |
| Llega mercadería a $1.100  | —                          | $1.100     |
| Llega mercadería a $1.100  | Corrección manual a $1.050 | **$1.050** |
| Corrección manual a $1.050 | Llega mercadería a $1.100  | **$1.100** |

Una recepción **no** le gana a una decisión posterior de una persona con
`products.cost.update`. Y una corrección manual no congela el costo para
siempre: el próximo camión manda.

### Por qué el `id` y no la fecha

`createdAt` sale de `now()`, que en PostgreSQL es la hora de **inicio de la
transacción**, no la del `INSERT`. Dos transacciones que se pisan pueden quedar
con las fechas al revés del orden en que realmente escribieron.

El `id` viene de una secuencia y se asigna en el `INSERT`, que ocurre **después**
del bloqueo. `registrarCambioDeCosto` toma `SELECT ... FOR UPDATE` sobre la fila
del producto antes de leer el costo actual, así que dos cambios simultáneos se
serializan y el orden de `id` es exactamente el orden de escritura.

`createdAt` sigue siendo lo que se le muestra a la gente. Para decidir, manda el
`id`.

### El cero que era mentira

Borrar el costo de un producto guardaba `newCost = 0`. Son dos afirmaciones
distintas y una es falsa:

- `0` → "no me costó nada", margen del 100 %
- `NULL` → "no sabemos"

La columna admite `NULL` desde la 3D, y la migración corrige las filas que ya
mentían — sólo las que cumplen las tres condiciones a la vez (dicen 0, son la
última del producto, y el producto quedó sin costo), que juntas describen un
único hecho posible.

## Ventas sin pagos: un caso legítimo

Una base anterior a la Fase 3.4 tiene ventas que nunca generaron movimiento de
caja y se migraron sin pagos. La migración lo dejó escrito.

La reconciliación las informa **bajo una regla distinta** — "toda venta tiene sus
pagos registrados" — y no mezcladas con "los importes no suman". Mezclarlas haría
que un dato viejo conocido se lea como un descuadre nuevo, y en dos meses nadie
distinguiría uno del otro.

## Rendimiento

Todas las consultas **agregan del lado de la base** y devuelven sólo las filas
que fallan. Una base con dos años de ventas no entra en memoria, y traerla para
sumarla en JavaScript sería exactamente lo que este proyecto no hace.

Los números salen como **texto** (`::text`). Un `numeric` que pasa por un
`number` de JavaScript ya perdió precisión antes de que nadie lo compare.

Las nueve comprobaciones corren **en serie**, no en paralelo: nueve consultas
pesadas a la vez sobre la base del comercio dejarían la caja esperando. No es un
camino caliente — se corre a mano o de madrugada, y puede tardar.

## Cómo se usa

```bash
npm run integrity:check
```

Ver [INTEGRITY_CHECK.md](INTEGRITY_CHECK.md).
