-- El nombre de usuario se guarda en su forma canonica: sin espacios en los
-- bordes y en minusculas (`normalizeUsername`, src/modules/users/username.ts).
-- El indice unico de "username" ya existe: con esta restriccion alcanza para
-- que la base no acepte "Franco" y "franco" como usuarios distintos.
--
-- Si dos usuarios difieren solo en mayusculas, la migracion falla ANTES de
-- tocar nada y dice cuales son. Elegir cual queda no es una decision de una
-- migracion.
DO $$
DECLARE
  colisiones TEXT;
BEGIN
  SELECT string_agg(usuarios, '; ') INTO colisiones
  FROM (
    SELECT string_agg(username, ', ' ORDER BY id) AS usuarios
    FROM "User"
    GROUP BY lower(btrim(username))
    HAVING count(*) > 1
  ) repetidos;

  IF colisiones IS NOT NULL THEN
    RAISE EXCEPTION 'Usuarios que difieren solo en mayusculas: %', colisiones;
  END IF;
END
$$;

UPDATE "User"
SET "username" = lower(btrim("username"))
WHERE "username" <> lower(btrim("username"));

ALTER TABLE "User"
  ADD CONSTRAINT "User_username_canonico"
  CHECK ("username" = lower(btrim("username")));
