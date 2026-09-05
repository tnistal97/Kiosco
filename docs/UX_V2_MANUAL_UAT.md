# UX V2 — Prueba manual de aprendizaje (UAT)

> **Para qué sirve.** Las pruebas automáticas garantizan que la caja funciona; esta garantiza que una persona que **nunca vio el sistema** la entiende sola. Se hace con una persona real, en un equipo real, con el lector conectado si lo hay.
>
> **Regla.** La única instrucción que se le da es: **«Esta es la caja.»** Nada más. Ni «apretá Enter», ni «buscá arriba». Si hace falta explicar algo, eso es un hallazgo.

## Preparación (quien conduce la prueba)

- [ ] Aplicación en producción local o staging, sembrada con `npm run seed:demo`.
- [ ] Usuario `cajero` (clave `Demo1234!`) ya ingresado; pantalla en `/venta`; caja abierta.
- [ ] Tres productos a mano con código de barras (por ejemplo yerba `7790001000011`, gaseosa `7790002000014`, leche `7790003000017`) y uno más para la segunda venta.
- [ ] Cronómetro y esta hoja. Un contador de clics (o anotar cada vez que toca el mouse).
- [ ] Si se prueba en un teléfono: 375 × 667 o el celular real, con el lector de cámara.
- [ ] No se responde ninguna pregunta durante la prueba. Se anota la pregunta.

## Consignas (se dicen una por vez, en este orden)

| #   | Consigna exacta                                     | Lo que tiene que pasar                                                                                     |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | «Vendé estos tres productos.»                       | Los pasa por el lector (o los busca escribiendo el nombre) y los tres aparecen en el ticket, con el total. |
| 2   | «La gaseosa son dos, no una.»                       | Cambia la cantidad de la gaseosa a 2 sin quitarla ni volver a escanearla.                                  |
| 3   | «La leche no la lleva.»                             | Quita la línea de la leche; el total baja.                                                                 |
| 4   | «Te paga en efectivo con un billete de veinte mil.» | Abre el cobro, elige efectivo (ya está elegido), escribe 20000 y confirma.                                 |
| 5   | «¿Cuánto vuelto le das?»                            | Lee el vuelto de la pantalla, en voz alta, sin calcular.                                                   |
| 6   | «Viene el siguiente cliente.»                       | Deja la caja lista para escanear el siguiente producto, y lo escanea.                                      |

## Registro (una fila por consigna)

| #   | Segundos | Clics de mouse | Teclas | Dudas que dijo en voz alta | Errores (qué hizo que no correspondía) | ¿Lo logró sin ayuda? |
| --- | -------- | -------------- | ------ | -------------------------- | -------------------------------------- | -------------------- |
| 1   |          |                |        |                            |                                        |                      |
| 2   |          |                |        |                            |                                        |                      |
| 3   |          |                |        |                            |                                        |                      |
| 4   |          |                |        |                            |                                        |                      |
| 5   |          |                |        |                            |                                        |                      |
| 6   |          |                |        |                            |                                        |                      |

## Umbrales (lo que se considera aprobado)

| Medida                           | Objetivo                                                        | Cómo se mide                                            |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Venta completa (consignas 1 a 6) | **≤ 90 s** la primera vez; **≤ 45 s** la segunda                | Cronómetro desde «Vendé» hasta el siguiente escaneo     |
| Uso del mouse                    | **0** obligatorio; que lo use no es falla, que lo _necesite_ sí | Se anota cada vez que toca el mouse y por qué           |
| Preguntas                        | **≤ 1** en toda la prueba                                       | Cualquier «¿y ahora?» cuenta                            |
| Vuelto                           | Lo lee **sin calcular** y sin buscarlo                          | Si tarda más de 3 s en encontrarlo, falla               |
| Recuperación                     | Un error no obliga a empezar de nuevo                           | Si borra el ticket por accidente o cierra sesión, falla |
| Segunda venta                    | Arranca sola con el siguiente escaneo                           | Si tuvo que tocar algo antes de escanear, anotar qué    |

## Después de la prueba (preguntas a la persona)

1. «¿Qué te pareció lo más fácil?»
2. «¿Hubo algo que no sabías cómo hacer?»
3. «¿Qué esperabas que pasara y no pasó?»
4. «Si tuvieras que explicarle a otra persona cómo cobrar, ¿qué le dirías?» (si la explicación es más larga que una frase, hay algo que corregir).

## Variantes (si hay tiempo)

- [ ] **Producto sin código** (pan): ¿lo encuentra escribiendo el nombre? ¿Descubre la estrella de favoritos?
- [ ] **Producto por peso** (queso): ¿entiende el diálogo de peso? ¿Usa la coma?
- [ ] **Transferencia**: ¿elige el medio sin que se lo digan?
- [ ] **Teléfono**: las mismas seis consignas en 375 px. Anotar si el teclado del teléfono tapa el vuelto.
- [ ] **Código desconocido**: ¿entiende «Código no registrado»? ¿Sabe qué hacer?
- [ ] **Números a mano**: en «Paga con» escribir `20000` (sin coma ni centavos), en el peso `1,5`, en el alta rápida un costo `0` y un precio `1.500`. Anotar si en algún momento la persona intenta escribir `,00` o si el sistema le pide otro formato. Debe aceptar todo tal cual y mostrarlo como `20.000,00`, `1,500 kg`, `0,00` y `1.500,00`.

## Resultado

| Persona | Fecha | Equipo | Venta 1 (s) | Venta 2 (s) | Clics | Preguntas | Aprobado |
| ------- | ----- | ------ | ----------- | ----------- | ----- | --------- | -------- |
|         |       |        |             |             |       |           |          |

Hallazgos para la próxima fase (una línea cada uno, con la consigna en la que apareció):

-
