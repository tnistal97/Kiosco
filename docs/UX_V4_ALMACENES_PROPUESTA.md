# PROPUESTA UX V4 — almacenes

> Estado: **propuesta, sin implementar, pendiente de aprobación**. Rama de
> partida `feat/ux-v2-phase2-1-lista-navegacion` @ `e2c0cac` (UX V3 de `/venta`
> más la preventa P0, ver [P0_PREVENTA.md](P0_PREVENTA.md)). Ningún componente,
> estilo, ruta, permiso ni regla de negocio se modificó para escribir esto.
>
> Lo que dice «hoy» sale del código en ese commit: el menú de
> `src/components/shell/navigation.ts`, el inicio de `src/app/(inicio)/page.tsx`,
> los roles de [PERMISSIONS_MATRIX.md](PERMISSIONS_MATRIX.md) y los textos de
> `src/app` y `src/components`.

---

## 0. En una página

**Para quién.** Almacenes de barrio, maxikioscos, despensas y minimercados de
una sola caja. Quien lo usa no es una persona técnica.

**Objetivo.** Que alguien de 50 a 60 años que nunca vio el sistema lo entienda
en 15 minutos.

**Regla.** No se elimina nada. Cambian los nombres, los lugares y qué se ve
primero. Los permisos del servidor, las direcciones, las reglas del dominio
(libro de inventario, FEFO, pagos, cuenta corriente, compras, costos) y los
datos quedan como están.

**Qué cambia.**

1. El menú pasa de 18 entradas a 11, más un «Más» cerrado.
2. El inicio deja de ser un tablero de 11 números y pregunta «¿Qué querés
   hacer?».
3. El cajero entra directo a Venta y ve cuatro cosas.
4. Las palabras de oficina se cambian por las del mostrador: «Fiado», «Llegó
   mercadería», «Recuento».
5. «Lotes» sale de la vista y queda «Vencimientos», solo para quien lo use.
6. Tres pantallas nuevas o rehechas —Consultar precio, Producto nuevo simple y
   Llegó mercadería— y un asistente de puesta en marcha.

**Decisiones que hacen falta para arrancar.**

| #   | Decisión                                                                      | Recomendación                                                                   |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | ¿Se aprueba el menú de 11 entradas más «Más» y la tabla de lenguaje?          | Sí                                                                              |
| 2   | Lotes: ¿conservar la lógica y mostrar «Vencimientos»?                         | Sí (opciones C y D de la sección 5)                                             |
| 3   | En «Llegó mercadería», ¿el proveedor es obligatorio?                          | Sí, pero rápido: viene elegido el último y se crea uno nuevo con solo el nombre |
| 4   | ¿Se autoriza la migración chica del nombre del comercio para el asistente?    | Sí; es la única de UX V4 y se pide aparte                                       |
| 5   | ¿«Vencimientos» (fase F6) entra en la V1 o pasa a los primeros clientes (P1)? | P1, salvo que el primer cliente lo necesite                                     |

---

## 1. Navegación (A)

### Hoy: 18 entradas en 6 grupos

| Grupo          | Entradas                                              |
| -------------- | ----------------------------------------------------- |
| (sin título)   | Inicio                                                |
| Operación      | Venta · Caja · Ventas · Clientes                      |
| Inventario     | Productos · Stock · Movimientos · Lotes · Inventarios |
| Compras        | Órdenes · Proveedores · Devoluciones                  |
| Control        | Reportes · Auditoría                                  |
| Administración | Usuarios · Sucursales · Configuración                 |

Un almacenero que abre el sistema por primera vez tiene que elegir entre
«Stock», «Movimientos», «Lotes» e «Inventarios» sin saber qué diferencia hay.

### Propuesta: 11 a la vista y un «Más» cerrado

```
Inicio
VENDER    Venta · Caja
NEGOCIO   Productos · Compras · Proveedores · Clientes y fiado
CONTROL   Stock · Reportes
SISTEMA   Usuarios · Configuración
Más ▸     Historial de stock · Vencimientos · Recuentos ·
          Devoluciones a proveedores · Historial de cambios · Sucursales
```

### Dónde queda cada entrada de hoy

| Hoy           | Queda en                          | Qué cambia                                                   |
| ------------- | --------------------------------- | ------------------------------------------------------------ |
| Inicio        | Inicio                            | Pantalla nueva (sección 3)                                   |
| Venta         | VENDER › Venta                    | Nada: es la de UX V3                                         |
| Caja          | VENDER › Caja                     | Suma el acceso «Ventas de hoy»                               |
| Ventas        | Caja («Ventas de hoy») y Reportes | Sale del menú; la pantalla sigue existiendo                  |
| Clientes      | NEGOCIO › Clientes y fiado        | Nombre                                                       |
| Productos     | NEGOCIO › Productos               | Nada                                                         |
| Órdenes       | NEGOCIO › Compras                 | Nombre; la acción principal pasa a ser «Llegó mercadería»    |
| Proveedores   | NEGOCIO › Proveedores             | Nada                                                         |
| Stock         | CONTROL › Stock                   | Nada                                                         |
| Reportes      | CONTROL › Reportes                | Orden interno (sección 9)                                    |
| Usuarios      | SISTEMA › Usuarios                | Tres roles a la vista (sección 2)                            |
| Configuración | SISTEMA › Configuración           | Lo básico a la vista y un «Avanzado»                         |
| Movimientos   | Más › Historial de stock          | Nombre; también se llega desde cada producto                 |
| Lotes         | Más › Vencimientos                | Nombre; aparece solo si algún producto controla vencimientos |
| Inventarios   | Más › Recuentos                   | Nombre; además, botón «Hacer un recuento» en Stock           |
| Devoluciones  | Más › Devoluciones a proveedores  | Nombre                                                       |
| Auditoría     | Más › Historial de cambios        | Nombre; solo el dueño                                        |
| Sucursales    | Más › Sucursales                  | No aparece si el comercio tiene una sola                     |

Es un cambio de presentación en `navigation.ts`: etiquetas, grupos y un grupo
que arranca cerrado. El permiso que gobierna cada entrada no se toca, y ninguna
dirección cambia.

---

## 2. Dueño y cajero (B)

No es solo seguridad: también es lo que cada uno ve.

|                                        | Cajero                                             | Dueño o administrador  |
| -------------------------------------- | -------------------------------------------------- | ---------------------- |
| Pantalla al entrar                     | Venta, directo                                     | Inicio                 |
| Menú                                   | Venta · Caja · Consultar precio · Clientes y fiado | El completo, más «Más» |
| Números del negocio (ganancia, costos) | No                                                 | Sí                     |

- **Los permisos no cambian.** Lo nuevo es el menú y la pantalla de entrada
  según el perfil, que se deduce del rol que el usuario ya tiene. No hace falta
  ningún dato nuevo en la base.
- **El encargado** ve el menú completo menos lo que hoy sus permisos no le
  dejan hacer.
- **«Clientes y fiado» para el cajero** aparece solo si su rol puede ver
  clientes, como hoy. La pantalla le muestra buscar y cobrar; lo que realmente
  puede hacer lo siguen decidiendo sus permisos.
- **Al crear un usuario** se ofrecen tres opciones, cada una con una línea que
  la explica:

  | Opción    | Texto                                        |
  | --------- | -------------------------------------------- |
  | Dueño     | «Ve y hace todo.»                            |
  | Encargado | «Maneja el día a día. No toca los usuarios.» |
  | Cajero    | «Vende, cobra y cierra su caja.»             |

  Los otros seis roles que existen (`admin`, `supervisor`, `repositor`,
  `compras`, `auditor` y `vendedor`, que es otro nombre de `cajero`) quedan en
  «Más roles».

---

## 3. Inicio (C)

```
¿Qué querés hacer?

[ Vender ]            [ Abrir caja ]     [ Llegó mercadería ]
[ Consultar precio ]  [ Fiados ]         [ Cambiar precios ]   ← solo con permiso de precios

Hoy   Ventas $182.400 · En caja $64.300 · Ganancia estimada $41.900 · Fiado pendiente $230.000

⚠ 8 productos con poco stock ›
⚠ 3 productos vencen esta semana ›         (solo si alguno controla vencimientos)
⚠ 2 clientes pasaron su límite de fiado ›
⚠ La caja de ayer quedó abierta ›
```

Los números del dibujo son de ejemplo.

- **Accesos.** Seis botones grandes. El de caja dice «Abrir caja» o «Caja
  abierta», según el estado.
- **Resumen.** Cuatro números: ventas de hoy, lo que hay en la caja, ganancia
  estimada y fiado pendiente. Los cuatro ya están en el tablero de hoy —son
  «Ventas de hoy», «Efectivo en caja», «Ganancia bruta hoy» y «Por cobrar»—:
  no hay cálculo nuevo. «Ganancia estimada» se llama así porque depende de los
  costos cargados.
- **Avisos.** En palabras, y cada uno lleva a la lista que lo resuelve.
- **Puesta en marcha.** Mientras falte algún paso de la sección 12, aparece
  «Te faltan 2 pasos para dejar el negocio listo».
- **Qué reemplaza.** El inicio de hoy: 11 tarjetas con números y la lista
  «Últimas ventas». Las otras siete tarjetas no se pierden:

  | Tarjeta de hoy                 | Dónde queda                     |
  | ------------------------------ | ------------------------------- |
  | «Recaudado hoy», «Cobrado hoy» | Caja y Reportes                 |
  | «Faltantes»                    | El aviso de poco stock, y Stock |
  | «Vencidos»                     | El aviso de vencimientos        |
  | «Esperando mercadería»         | Compras                         |
  | «Cuentas por pagar»            | Proveedores, como «Le debés»    |
  | «Inventarios abiertos»         | Más › Recuentos                 |

- **El cajero** no ve esta pantalla: entra a Venta.

---

## 4. Lenguaje (D)

Reglas:

1. Cambia solo lo que se lee en pantalla. Nombres internos, API, base de datos
   y conceptos contables quedan igual.
2. Una cosa, un nombre: el mismo en el menú, en el título, en el botón y en el
   mensaje de error.
3. Los botones llevan un verbo: «Cobrar», «Guardar», «Contar la plata».
4. Las pruebas que buscan por texto se actualizan en la misma fase.

| Texto actual                                         | Texto propuesto                                   | Motivo                                      |
| ---------------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| «Órdenes», «orden de compra»                         | «Compras», «pedido a proveedor»                   | «Orden de compra» es lenguaje de oficina    |
| «Recibir mercadería», «recepción»                    | «Llegó mercadería»                                | Es como lo dice el almacenero               |
| «Movimientos», «Movimientos de stock de la sucursal» | «Historial de stock»                              | «Movimiento» no explica nada                |
| «Ajustar stock»                                      | Se mantiene                                       | Ya dice qué hace                            |
| «Inventarios», «Inventarios físicos»                 | «Recuento»                                        | «Inventario» se confunde con stock          |
| «Conteo a ciegas»                                    | «Recuento sin ver lo que dice el sistema»         | Describe lo que pasa                        |
| «Lotes», «Partida»                                   | «Vencimientos», «Vence el…»                       | Lo que importa es la fecha                  |
| «Trazabilidad» (en la ficha del producto)            | «¿Controlás vencimientos?»                        | Una pregunta de sí o no                     |
| «Turnos», «Turnos de caja», «Turnos cerrados»        | «Caja», «Cajas anteriores»                        | En el negocio se abre y se cierra «la caja» |
| «Esperado del turno en curso»                        | «Tendría que haber en la caja»                    | Dice qué es el número                       |
| «Arqueos»                                            | «Contar la plata»                                 | Describe la acción                          |
| «Cuenta corriente»                                   | «Fiado»                                           | Es la palabra del mostrador                 |
| «Saldo» (de un cliente)                              | «Debe $…» / «A favor $…»                          | Sin signos y sin «saldo»                    |
| «Por cobrar»                                         | «Te deben»                                        | Directo                                     |
| «Cuentas por pagar»                                  | «Le debés a proveedores»                          | Directo                                     |
| «Anticipos», «Anticipos sin imputar»                 | «Pagos adelantados», «Pagos adelantados sin usar» | Más claro                                   |
| «Imputar»                                            | «¿Qué compras paga?»                              | Evita la jerga contable                     |
| «Ganancia bruta», «Ganancia bruta hoy»               | «Ganancia estimada»                               | Depende de los costos cargados              |
| «Markup»                                             | «Recargo sobre el costo»                          | Es jerga en inglés                          |
| «Unidad de compra»                                   | «Viene en caja de \_\_\_»                         | Así lo piensan                              |
| «Faltantes»                                          | «Sin stock»                                       | Directo                                     |
| «Devoluciones»                                       | «Devoluciones a proveedores»                      | Hoy no dice a quién                         |
| «Auditoría»                                          | «Historial de cambios»                            | Dice qué es                                 |

---

## 5. Lotes (E)

Los lotes nacieron con necesidades que un almacén no tiene: número de partida
para retirar un producto, fecha de elaboración, lote obligatorio. Las cuatro
opciones que se evaluaron:

| Opción | Qué es                                     | Veredicto                  |
| ------ | ------------------------------------------ | -------------------------- |
| A      | Ocultarlos                                 | Sí, como consecuencia de D |
| B      | Sacarlos de la navegación principal        | Sí: pasan a «Más»          |
| C      | Conservar la lógica internamente           | **Sí**                     |
| D      | Convertir la experiencia en «Vencimientos» | **Sí**                     |

**Recomendación: C y D.** Se conservan todas las tablas y toda la lógica.
«Lotes» sale del menú principal y el almacenero ve «Vencimientos», que aparece
solo si algún producto controla vencimientos. No se elimina ninguna tabla.

**Qué sirve tal cual para un almacén.**

- La fecha de vencimiento de cada lote.
- El stock de cada lote.
- Que en la venta salga primero lo que vence antes (FEFO).
- Que lo vencido deje de ser vendible sin dejar de ocupar stock.
- El reporte de vencimientos.

**Qué era específico.**

- El código de partida y el retiro de una partida.
- La fecha de elaboración.
- El lote obligatorio por producto.
- La asignación manual de lotes.

**Riesgo de quitarlos.** FEFO y los controles de la base dependen de esas
tablas. Sacarlas sería una migración destructiva y rompería la venta de
productos que hoy tienen stock en lotes. Ocultarlas no tiene riesgo: se
deshace cambiando el menú.

**Qué ve el almacenero.**

- En la ficha del producto, un tilde «¿Controlás vencimientos?».
- En «Llegó mercadería», un campo opcional «Vence el» para esos productos.
- En Inicio, un aviso como «3 productos vencen esta semana».
- En Stock, el filtro «Por vencer».
- Nunca las palabras «lote» ni «partida». Quien hoy usa partidas las sigue
  teniendo en «Más › Vencimientos».

**A confirmar al implementar.** Hoy la base exige control de lotes para guardar
un vencimiento. La idea es usar el control «opcional» con un código de lote
generado a partir de la fecha, sin tocar el modelo. Si esa restricción no lo
permite, se frena y se consulta antes de cambiar nada.

---

## 6. Producto nuevo (F)

Hoy el alta rápida desde la caja pide seis campos, y el alta desde Productos
muestra todas las secciones a la vez, incluidas «Markup» y «Trazabilidad».

```
Se escanea un código que no existe  →  «No está cargado. ¿Lo agregamos?»

  Nombre   [                    ]
  Precio   [        ]
  Costo    [        ]   (opcional)
  Stock    [        ]   (opcional: cuántos tenés ahora)

  [ Guardar y vender ]          Más opciones ▾
```

- **Desde Venta:** el botón es «Guardar y vender»: guarda, lo suma al ticket y
  devuelve el foco al lector.
- **Desde Productos:** el botón es «Guardar», y al lado «Guardar y cargar
  otro».
- **«Más opciones»:** categoría, si se vende por peso, stock mínimo, proveedor,
  otros códigos y vencimientos.
- **Lo que no se pide tiene un valor sensato:** categoría «Sin categoría» (la
  misma que usa la importación), unidad «unidad», stock cero, costo vacío. Un
  costo vacío no es un costo cero.
- **Por dentro no cambia nada:** el stock inicial entra por el libro de
  inventario y el costo por su historial, como hoy.

---

## 7. Llegó mercadería (G)

```
Llegó mercadería

  Escanear o buscar  [                 ]

  Yerba mate 1 kg      cantidad [ 12 ]   costo [ 3.200 ]   antes 2.950 ▲
  Azúcar 1 kg          cantidad [ 10 ]   costo [ 1.100 ]
  …

  [ Guardar ]

Al guardar:
  ¿De qué proveedor?   [ Distribuidora Sur ▾ ]   (viene el último)   + Nuevo
  ¿Lo pagaste?         ( ) Sí, de la caja   ( ) Sí, por otro medio   ( ) No, queda debiendo
```

- **El camino:** escanear, cantidad, costo, siguiente producto, guardar.
- **El costo** viene completado con el último y avisa si cambió.
- **Por dentro** usa los procesos de compras que ya existen: la recepción
  mueve el stock por el libro de inventario, actualiza el historial de costos y,
  si no se pagó, deja la deuda con el proveedor. Si se pagó de la caja, sale
  el egreso de la caja abierta. El usuario no ve ni órdenes ni recepciones.
- **Proveedor.** La recomendación es que sea obligatorio pero rápido: viene
  elegido el último y se puede crear uno nuevo con solo el nombre. Sin
  proveedor, la compra y la deuda quedarían fuera de los reportes.
- **Vencimientos.** Si el producto los controla, aparece «Vence el».
- **Riesgo.** Hoy la orden de compra y la recepción son dos pasos. Encadenarlos
  en una sola operación depende de que esos procesos acepten una transacción
  compartida. Es lo primero que se comprueba al empezar la fase; si no se
  puede sin tocar sus reglas, se frena y se consulta.

---

## 8. Consultar precio (H)

```
Consultar precio

  [ escaneá o escribí ]

  Yerba mate 1 kg
  $ 4.850
  Quedan 14

  Esc para volver
```

- Un solo campo, con el foco puesto. Sirve el lector y sirve escribir el
  nombre.
- Muestra nombre, precio grande y stock. No se edita nada.
- Si no existe: «No está cargado», y el botón «Cargarlo» para quien tenga
  permiso.
- Se entra desde Inicio, desde el menú del cajero y con un atajo desde Venta.
- Usa la búsqueda por código que la caja ya tiene.

---

## 9. Una acción principal por pantalla (J)

No es un rediseño visual: los componentes y los estilos son los mismos. Cambia
cuántas cosas compiten por la atención.

- **Una acción principal** por pantalla, grande y siempre en el mismo lugar.
- **Las secundarias** van en «⋯ Más».
- **Botones** con verbo corto, grandes para el dedo.
- **En el teléfono**, la acción principal queda abajo.

| Pantalla                 | Acción principal                                              | Qué pasa a «⋯ Más» o cambia                                 |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Inicio                   | Los seis accesos                                              | Las 11 tarjetas de hoy                                      |
| Venta                    | Sin cambios (UX V3)                                           | Solo textos y el atajo a Consultar precio                   |
| Consultar precio (nueva) | Escanear y ver el precio                                      | —                                                           |
| Producto nuevo           | «Guardar y vender» o «Guardar»                                | Todo lo que no sea nombre, precio, costo y stock            |
| Llegó mercadería (nueva) | «Guardar»                                                     | Pedidos a proveedores y devoluciones                        |
| Caja                     | «Abrir caja» o «Cerrar caja»                                  | Ingresos y egresos, ventas del día, cajas anteriores        |
| Clientes y fiado         | «Cobrar», en cada cliente; la lista ordenada por lo que deben | Límites, ajustes e historial                                |
| Productos                | «Nuevo producto»                                              | Cambiar precios, importar una lista                         |
| Stock                    | «Ajustar stock»; filtros «Poco stock», «Sin stock»            | Recuento e historial                                        |
| Compras                  | «Llegó mercadería»                                            | Pedidos a proveedores, devoluciones                         |
| Proveedores              | «Pagar», con «Le debés $…» a la vista                         | El detalle de la cuenta                                     |
| Reportes                 | Ventas de hoy, la semana y el mes; ganancia; lo más vendido   | Costos, stock valorizado, compras y caja, en «Más reportes» |
| Usuarios                 | «Nuevo usuario», con tres roles                               | «Más roles»                                                 |
| Configuración            | Lo básico                                                     | «Avanzado»                                                  |

---

## 10. Modo simple (K)

**Recomendación: todo arranca simple, y un solo interruptor.**

- No se propone un «modo» con dos versiones de cada pantalla. Serían el doble
  de pruebas, y el soporte terminaría en «a mí no me aparece».
- Un interruptor, **«Mostrar herramientas avanzadas»**, que ven el dueño y el
  encargado. Deja «Más» abierto en el menú y «Más opciones» desplegado en los
  formularios.
- Se guarda en cada dispositivo. No necesita migración.

---

## 11. Qué sacar u ocultar (L)

| Módulo                              | Mantener      | Ocultar                     | Renombrar                  | Mover a avanzado          | Eliminar en el futuro                               |
| ----------------------------------- | ------------- | --------------------------- | -------------------------- | ------------------------- | --------------------------------------------------- |
| Auditoría                           | Sí            | —                           | Historial de cambios       | Sí, solo el dueño         | No                                                  |
| Inventarios                         | Sí            | —                           | Recuento                   | Sí, con un botón en Stock | No                                                  |
| Lotes                               | Sí, la lógica | Sí, la pantalla             | Vencimientos               | Sí, las partidas          | Evaluar partida y retiro de partidas tras el piloto |
| Movimientos                         | Sí            | —                           | Historial de stock         | Sí, y desde cada producto | No                                                  |
| Reportes técnicos                   | Sí            | —                           | —                          | Sí, en «Más reportes»     | Los que nadie use en el piloto                      |
| Administración (sucursales y roles) | Sí            | Sucursales, si hay una sola | —                          | Sí                        | No                                                  |
| Configuraciones avanzadas           | Sí            | —                           | —                          | Sí                        | No                                                  |
| Órdenes de compra                   | Sí            | —                           | Pedidos a proveedores      | Dentro de Compras         | No                                                  |
| Devoluciones                        | Sí            | —                           | Devoluciones a proveedores | Sí                        | No                                                  |
| Ventas (el listado)                 | Sí            | Sale del menú               | —                          | Desde Caja y Reportes     | No                                                  |

Nada se elimina ahora. Lo que figura como candidato se decide con datos de uso
del piloto, no antes.

---

## 12. Puesta en marcha (I)

Un asistente que aparece la primera vez que entra el dueño. Se puede saltear y
retomar, y queda como lista en Inicio. Cada paso se marca solo cuando los datos
ya están, así que no hay un estado aparte que mantener en la base. Los pasos 2
y 4 son opcionales.

| Paso                 | Qué pregunta                                                                                 | Se da por hecho cuando…      |
| -------------------- | -------------------------------------------------------------------------------------------- | ---------------------------- |
| 1. Datos del negocio | El nombre del comercio                                                                       | Tiene nombre                 |
| 2. Usuarios          | «¿Quién más atiende?» Se crean los cajeros, con una contraseña temporal                      | Hay otro usuario (opcional)  |
| 3. Productos         | Subir el Excel (importación de P0-B, con su plantilla), cargarlos a mano o arrancar vacío    | Hay al menos un producto     |
| 4. Stock inicial     | Si el Excel lo traía, ya está. Si no, un recuento rápido, o se saltea y todo arranca en cero | Hay stock cargado (opcional) |
| 5. Caja              | «¿Con cuánta plata abrís?» Abre la primera caja                                              | Hay una caja abierta         |

Al final: **«Tu negocio está listo»**, con el botón «Hacer primera venta».

Meta: menos de 30 minutos con el Excel a mano.

**La única migración de UX V4.** El nombre del comercio hoy sale de la
configuración del servidor (`COMMERCE_NAME`). Para que el dueño lo escriba en
el paso 1 hace falta una columna nueva, chica y sin riesgo para los datos. Se
pide aparte, antes de la fase F7, y no se hace sin aprobación.

---

## 13. Prueba de usabilidad (M)

**Con quién.** De 3 a 5 personas de 50 a 60 años sin experiencia en sistemas.

**Cómo.** Sin explicarles nada antes, con datos de demostración y en la
computadora del local. Se anota el tiempo, cada duda (más de 10 segundos sin
tocar nada) y cada palabra que no entienden.

| Tarea, sin ayuda                                                      | Tiempo máximo |
| --------------------------------------------------------------------- | ------------- |
| 1. Abrir la caja con $20.000                                          | 1 min         |
| 2. Vender 3 productos (uno por peso) y cobrar en efectivo, con vuelto | 2 min         |
| 3. Cargar mercadería: 5 productos de un proveedor, pagada             | 4 min         |
| 4. Subir 10 % los precios de una categoría                            | 3 min         |
| 5. Registrar que un cliente pagó $5.000 de su fiado                   | 2 min         |
| 6. Ver cuánto se vendió hoy                                           | 1 min         |
| **Total**                                                             | **15 min**    |

**Se aprueba** si cada persona hace al menos 5 de las 6 tareas sin ayuda y
ninguna tarea falla para la mayoría.

La misma prueba, con una persona y sobre la versión actual, sirve de línea de
base antes de empezar (fase F0). La guía de [UX_V2_MANUAL_UAT.md](UX_V2_MANUAL_UAT.md)
sigue valiendo para la caja.

---

## 14. Cuándo la V1 está lista para vender (N)

### P0 — antes de cobrarle al primer cliente

| Criterio                                                                                                                     | Estado                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Producción corre la última versión y el chequeo de salud dice cuál es                                                        | Pendiente                                                 |
| Las fases F1 a F5 y F7 de esta propuesta están hechas                                                                        | Pendiente                                                 |
| Un comercio queda funcionando en menos de 30 minutos con su Excel                                                            | Pendiente (F7)                                            |
| Alta de 2.000 productos desde un Excel real, sin ayuda                                                                       | A medias: P0-B está hecho; falta probar con listas reales |
| Cambio masivo de precios                                                                                                     | Hecho (P0-B)                                              |
| Cambio y reseteo de contraseña desde la aplicación                                                                           | Hecho (P0-A)                                              |
| Respaldo diario fuera del servidor y restauración probada en una base limpia                                                 | Pendiente                                                 |
| Aviso automático si la aplicación se cae, se llena el disco o hay errores                                                    | Pendiente                                                 |
| Licencia y visibilidad del repositorio decididas                                                                             | Pendiente                                                 |
| El proxy espera lo suficiente para una importación grande                                                                    | Pendiente                                                 |
| Prueba de usabilidad aprobada, incluida una venta sin ayuda                                                                  | Pendiente                                                 |
| Piloto de 2 semanas en un almacén real sin incidentes graves: no se pierden datos, la caja cuadra, ninguna venta mal cobrada | Pendiente                                                 |

### P1 — primeros clientes

- Vencimientos (F6).
- Pulir el resto de las pantallas (F8).
- Imprimir y reimprimir el ticket.
- Nombre del comercio editable y cambio obligatorio de la contraseña temporal
  (migraciones chicas).
- Exportar a Excel.
- Dejar una venta en espera.

### P2 — más adelante

- Factura electrónica.
- Varias sucursales.
- Funcionar sin conexión.
- Balanza con etiqueta.
- Descuentos y promociones.
- Varios comercios en una misma instalación.

---

## 15. Orden de implementación y estimación

Días de desarrollo con pruebas, no días de calendario.

| Fase | Qué                                                                      | Días                | Por qué en ese lugar                                                  |
| ---- | ------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------- |
| F0   | Línea de base: la prueba de la sección 13 con 1 persona, sobre lo actual | 0,5 (opcional)      | Para comparar antes y después                                         |
| F1   | Lenguaje y menú                                                          | 2 a 3               | Toca todas las pantallas y las pruebas: conviene hacerlo una sola vez |
| F2   | Inicio y perfiles (el cajero entra a Venta)                              | 2 a 3               | Es lo primero que ve cada uno                                         |
| F3   | Consultar precio                                                         | 1                   | Chica, y el cajero la necesita en su menú                             |
| F4   | Producto nuevo simple                                                    | 1 a 2               | La usan Venta y Llegó mercadería                                      |
| F5   | Llegó mercadería                                                         | 3 a 4               | La más incierta: depende de encadenar los procesos de compras         |
| F6   | Vencimientos                                                             | 3 a 4 (opcional)    | Puede pasar a P1                                                      |
| F7   | Puesta en marcha                                                         | 3 a 4               | Encadena las pantallas ya simplificadas; lleva la migración chica     |
| F8   | Pulido del resto de las pantallas de la sección 9                        | 3 a 4               | Caja, Clientes y fiado, Stock, Compras, Proveedores, Reportes         |
| F9   | Prueba de usabilidad y ajustes                                           | 2, más 2 de ajustes | Mide todo junto                                                       |
|      | **Total**                                                                | **22 a 29**         | 19 a 25 sin F6                                                        |

Cada fase cierra con sus pruebas, la construcción y capturas en computadora y
en teléfono. Puntos de revisión propuestos: al terminar F2, F5 y F8.

---

## 16. Lo que no se toca

- El esquema de la base y las migraciones, salvo la columna del nombre del
  comercio, que se pide aparte.
- El libro de inventario: el stock sigue sin editarse a mano.
- FEFO y las reglas de lotes.
- Las reglas de pagos, de la caja y de la cuenta corriente.
- Las reglas de compras y el historial de costos.
- Los permisos y lo que cada rol puede hacer.
- La pantalla de venta de UX V3, más allá de los textos y un atajo.

Si alguna fase descubre que necesita tocar algo de esta lista, se frena y se
consulta.

---

## 17. Riesgos de la propuesta

1. **Las pruebas buscan por texto.** Cambiar etiquetas rompe pruebas de
   pantalla y de punta a punta. F1 las actualiza; el costo está en su
   estimación.
2. **Llegó mercadería** depende de que la orden y la recepción se puedan
   encadenar sin tocar sus reglas (sección 7).
3. **Vencimientos** depende de la restricción de la base sobre lotes y fechas
   (sección 5).
4. **Ocultar puede esconder algo que alguien usa.** Lo cubre el interruptor de
   herramientas avanzadas, y nada se elimina.
5. **El asistente necesita una migración.** Es aditiva y chica, pero es la
   primera desde la Fase 5A (agosto de 2026), y pasa por el mismo
   procedimiento que las demás
   ([DATABASE_MIGRATION_STRATEGY.md](DATABASE_MIGRATION_STRATEGY.md)).
