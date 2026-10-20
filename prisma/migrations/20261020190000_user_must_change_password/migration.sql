-- =============================================================================
-- Contraseña temporal: cambio obligatorio en el primer ingreso
--
-- Que hace: agrega "User"."mustChangePassword", falso por omision.
--
-- Por que: cuando la contrasena la elige otra persona --el alta de un
-- empleado, el reseteo de una olvidada-- la conocen dos personas. Hasta ahora
-- cambiarla dependia de que el empleado se acordara de entrar a
-- Configuracion. Con la columna en verdadero, la sesion solo sirve para
-- elegir una nueva: el resto de la API responde PASSWORD_CHANGE_REQUIRED.
--
-- Aditiva: con NOT NULL y DEFAULT false, los usuarios existentes quedan como
-- estaban y la version anterior del codigo sigue funcionando (no la lee).
-- =============================================================================

ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- DOWN (manual, no lo ejecuta Prisma):
-- ALTER TABLE "User" DROP COLUMN "mustChangePassword";
