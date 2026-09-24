/**
 * RETIRADO. No hace nada: explica que usar y sale con error.
 *
 * Este seed borraba las tablas principales con `deleteMany` sin mirar contra
 * que base corria, y creaba un administrador con una clave fija escrita en el
 * repositorio, que es publico. Contra una base con datos reales hacia las dos
 * peores cosas posibles; contra una con libros protegidos por trigger, fallaba
 * a mitad de camino y la dejaba a medio borrar.
 *
 * Lo reemplazan:
 *
 *   - `npm run alta:instancia` (scripts/alta-instancia.ts): una instancia real.
 *     No borra nada, se niega sobre una base con datos y genera la clave.
 *   - `npm run seed:demo` (prisma/seed-demo.ts): datos de demostracion, solo
 *     contra una base terminada en `_dev`.
 *
 * El archivo se conserva para que `npm run seed` diga esto en vez de fallar
 * con un "no existe", y porque la prueba de columnas congeladas lo revisa.
 */

console.error(
  [
    '',
    'prisma/seed.ts está retirado: borraba datos sin preguntar y dejaba una clave fija.',
    '',
    '  Instancia nueva:        npm run alta:instancia -- --ayuda',
    '  Datos de demostración:  npm run seed:demo   (solo bases *_dev)',
    '',
  ].join('\n'),
)
process.exit(1)
