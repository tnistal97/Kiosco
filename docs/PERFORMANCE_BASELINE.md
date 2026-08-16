# Línea base de rendimiento

> Fase 5A.2. Números **medidos**, no estimados. Sirven para comparar: una fase
> posterior que duplique cualquiera de estos tiempos tiene algo que explicar.

## Cómo se midió

- `npm run test:performance`, sobre `tests/performance/linea-base.test.ts`.
- Máquina quieta: sin el servidor de desarrollo, sin E2E y sin `build` corriendo
  en paralelo.
- PostgreSQL 18.3 local, puerto 5433, base `kiosco_test`, en el mismo equipo.
- Node v24.14.1 · Windows 11 · commit de referencia: la RC 1.0.0-rc.3.
- Catálogo de **10.000 productos** con dos códigos cada uno (20.000 filas en
  `ProductBarcode`) y `ANALYZE` corrido antes de medir, para que el planificador
  no trabaje con estadísticas de una tabla vacía.
- Cada número es **una** ejecución de la ruta completa: validación de sesión,
  permisos, servicio, transacción y serialización de la respuesta. No es el
  tiempo de una consulta suelta.

Los tiempos dependen de la máquina y por eso **no se afirman en las pruebas**;
lo que se afirma es un techo de 30 s por camino, que no mide nada salvo una
regresión de orden de magnitud. Lo que sí se afirma con precisión es la _forma_:
el número de sentencias SQL y el plan de consulta, en `consultas-n1.test.ts` y
en `queries.test.ts`.

## Los diez caminos

| Camino                                   |   Tiempo |
| ---------------------------------------- | -------: |
| Barcode encontrado                       |   6,3 ms |
| Barcode inexistente                      |   3,0 ms |
| Alta rápida (producto + stock inicial)   |  26,1 ms |
| Stock vendible (producto con 20 lotes)   |   6,4 ms |
| Venta con FEFO sobre 20 lotes            |  40,0 ms |
| Venta de 15 líneas                       |  37,8 ms |
| Recepción de 20 líneas                   | 126,3 ms |
| Cuenta corriente de un cliente           |   8,3 ms |
| Cuenta corriente de un proveedor         |  11,2 ms |
| Inventario de 1.000 líneas — crear       |  40,8 ms |
| Inventario de 1.000 líneas — leer página |   9,2 ms |

## El lector, con catálogos grandes

| Catálogo          | Acierto | Código inexistente |
| ----------------- | ------: | -----------------: |
| 10.000 productos  |  5,5 ms |             3,7 ms |
| 100.000 productos |  4,6 ms |             2,9 ms |

**Diez veces más catálogo y el mismo tiempo.** No es casualidad ni suerte del
planificador: `ProductBarcode.code` tiene un índice único y la consulta es un
acierto directo. Las diferencias entre las dos filas son ruido de medición — el
número con 100.000 salió más bajo que el de 10.000, que es exactamente lo que se
espera de algo que no depende del tamaño.

El código inexistente lee **cero filas**, comprobado con
`EXPLAIN (ANALYZE, FORMAT JSON)`. Es el caso que importa: desde la Fase 5A.1 un
código desconocido abre el alta rápida, así que se dispara seguido y no puede
pagar el catálogo entero.

## Cuántas sentencias SQL

El tiempo dice cuánto tarda hoy; el número de sentencias dice si va a seguir
tardando lo mismo cuando haya diez veces más datos. Los dos números que conviene
recordar:

| Camino                           | Sentencias | Crece con los datos |
| -------------------------------- | ---------: | ------------------- |
| Barcode (una lectura)            |          8 | **No**              |
| Listado de caja (50 movimientos) |          7 | **No**              |

Las ocho del lector, una por una: dos de la sesión (usuario y rol), una del
código por el índice único, una del producto, y cuatro de sus relaciones
—categoría, proveedor principal, stock de la sucursal y código principal—, que
Prisma resuelve cada una con su propia consulta.

> **Optimización identificada y NO aplicada.** El POS no muestra el proveedor, y
> esa relación cuesta una de las ocho. Sacarla del camino del lector obligaría a
> partir `CAMPOS_PRODUCTO` en dos formas distintas —la duplicación que el módulo
> evita a propósito— para ahorrar una consulta de índice sobre una tabla chica.
> Con 6 ms de extremo a extremo no paga. Queda anotado por si algún día el
> número deja de ser 6 ms.

## Lo que NO se mide con un cronómetro

- **N+1**: se detecta corriendo el mismo escenario con dos volúmenes y
  comprobando que el número de sentencias no se mueva. Ver
  [QUALITY_STRATEGY.md](QUALITY_STRATEGY.md) y `consultas-n1.test.ts`.
- **Recorrido de tabla**: se detecta con `EXPLAIN`. Contar sentencias no
  distingue una consulta que lee una fila de una que recorre doscientas mil:
  las dos cuentan uno.
- **Respuesta sin límite**: se detecta midiendo el tamaño de la respuesta con
  dos volúmenes de datos. Ver `queries.test.ts`.
