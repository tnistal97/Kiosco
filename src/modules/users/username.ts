/**
 * El nombre de usuario en su forma canonica.
 *
 * "Franco", "franco" y " FRANCO " son la misma persona. La base guarda solo la
 * forma canonica --una restriccion CHECK rechaza cualquier otra-- y el indice
 * unico de `User.username` hace el resto: no pueden existir dos usuarios que
 * difieran en mayusculas.
 *
 * Es el unico lugar con esta regla. Lo usan el login, los esquemas de alta y
 * edicion, el limite de intentos y los guiones de operacion. Vive aparte y sin
 * dependencias porque tambien corre en el navegador.
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}
