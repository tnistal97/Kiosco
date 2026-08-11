# Ensayo de migración: respaldar **y restaurar**

## Por qué existe este documento

Todo el mundo sabe hacer un `pg_dump`. Casi nadie sabe si su respaldo sirve,
porque nunca abrió uno.

Un archivo `.dump` que jamás se restauró no es un respaldo: es una suposición
con nombre de archivo. Puede estar truncado, puede haberse hecho contra la base
equivocada, puede que la versión de `pg_restore` disponible no lo lea, puede que
falten los permisos del rol. Todo eso se descubre el día que hace falta, que es
el peor día posible.

Por eso el ensayo llega hasta el final:

```
respaldar → migrar → reconciliar → RESTAURAR EN OTRA BASE → comparar
```

Los dos últimos pasos son el punto. Los tres primeros son el precio de llegar.

## Cómo se corre

```bash
npm run rehearsal
```

Sobre **bases descartables**: `kiosco_rehearsal_origen` y
`kiosco_rehearsal_restaurada`. El guion las crea, las usa y las borra. Si la URL
apunta a cualquier otro nombre, aborta antes de conectar — no hay forma de
apuntarlo sin querer a producción.

Necesita `pg_dump` y `pg_restore` en el `PATH`, o `PG_BIN` apuntando a la
carpeta de binarios de PostgreSQL:

```bash
PG_BIN="/c/Program Files/PostgreSQL/18/bin" npm run rehearsal
```

## Los siete pasos

| #   | Qué                                                               | Qué demuestra                      |
| --- | ----------------------------------------------------------------- | ---------------------------------- |
| 1   | Crea la base y aplica toda la cadena, más el seed de demostración | La cadena corre de cero            |
| 2   | `pg_dump --format=custom`                                         | Se puede respaldar                 |
| 3   | `prisma migrate diff --exit-code`                                 | No hay deriva                      |
| 4   | `integrity:check` sobre el origen                                 | Lo migrado **cierra**              |
| 5   | `pg_restore` en **otra** base                                     | **El respaldo se puede abrir**     |
| 6   | Compara la huella de las dos                                      | Lo restaurado **es** lo respaldado |
| 7   | `integrity:check` sobre la restaurada                             | Y lo restaurado también cierra     |

### La huella

Comparar dos bases entera por entera es caro y frágil (los ids de secuencia, los
timestamps de sistema). La huella compara lo que importa:

```
CashRegisterMovement:     26 filas, suma  71100.00
Client:                    3 filas, suma  17940.00
CustomerAccountMovement:   6 filas, suma  17940.00
CustomerPayment:           2 filas, suma  10000.00
Product:                  43 filas, suma 187430.00
Sale:                     15 filas, suma  93250.00
SaleItem:                 41 filas, suma    128.500
StockMovement:            73 filas, suma   1204.000
PurchaseReceiptItem:       5 filas, suma     64.000
```

Cantidad de filas **y suma de la columna que importa** de cada tabla. Un
`pg_restore` truncado cambia el conteo; uno que perdió precisión cambia la suma.
Las dos juntas son difíciles de pasar por casualidad.

Las tres tablas de cuenta corriente entraron en la Fase 4A. Sin ellas, un
respaldo que perdiera el libro de clientes se restauraría y la comparación diría
que todo está bien: **la deuda de cada persona habría desaparecido sin que nada
avisara.** `Client` suma su saldo y `CustomerAccountMovement` sus movimientos, y
los dos números tienen que coincidir por la invariante del libro — así que la
huella comprueba la reconciliación de paso.

## Qué hacer con esto antes de tocar producción

1. Correr el ensayo. Si falla, no se despliega.
2. Respaldar producción de verdad, con el mismo comando del paso 2.
3. **Restaurar ese respaldo** en una base descartable y correr
   `integrity:check` contra ella. Es el paso que este documento existe para no
   saltear.
4. Aplicar la cadena.
5. Correr `integrity:check` contra producción.

Si el paso 5 encuentra algo, el respaldo del paso 3 ya está probado y se sabe
que sirve. Ése es todo el valor de haberlo hecho antes.

## Las migraciones destructivas de esta fase

`20260810130000_phase3d_drop_legacy_columns` borra dos columnas. Antes de
aplicarla en un servidor con datos:

- Las dos comprobaciones internas de la migración abortan si algún dato quedó
  sin migrar; leer el mensaje y **no** borrar la comprobación.
- El `ROLLBACK` está escrito al final del archivo, comentado, con lo que se
  recupera y lo que no.
- `Product.supplierId` se reconstruye fiel desde `ProductSupplier`.
  `Supplier.contact` **no**: la reversión lo rellena con `contactName`, que es
  el texto migrado o su versión limpia.

`tests/migrations/chain.test.ts` exige que toda migración destructiva declare
motivo, prueba y respaldo, y comprueba que los tres existan de verdad — que la
prueba nombrada esté escrita y que este archivo exista. Una ficha que cite una
prueba inexistente hace fallar la suite.

## Lo que este ensayo NO cubre

- **El tamaño.** Corre sobre el seed de demostración, que son decenas de filas.
  Una migración que tarda dos segundos acá puede tardar minutos sobre dos años
  de ventas, y una que bloquea una tabla puede dejar la caja sin vender. Antes de
  producción hay que medirla sobre una copia del volumen real.
- **La ventana.** No dice cuánto tiempo estaría el sistema detenido.
- **El rollback aplicado.** Los bloques `ROLLBACK` están escritos y revisados,
  pero no se ejecutan. Ejecutarlos exigiría una base con el esquema posterior y
  datos posteriores, y hoy la respuesta ante un problema es restaurar el
  respaldo, que sí está probado.
