/**
 * Achica una foto en el navegador antes de mandarla.
 *
 * Una foto del telefono pesa 3 a 5 MB y el servidor la va a dejar en 480 px:
 * subirla entera es esperar de mas con datos moviles, y ademas Nginx corta por
 * omision los cuerpos de mas de 1 MB. A 1024 px y en JPEG queda en 100 a
 * 300 kB, con lugar de sobra para que el servidor recorte y achique.
 *
 * Fondo blanco porque JPEG no tiene transparencia: un PNG recortado queda
 * sobre blanco, como las fotos de catalogo. Si el navegador no puede
 * decodificarla --un HEIC fuera de Safari, un navegador viejo-- se manda el
 * archivo tal cual y el servidor decide.
 */
const LADO = 1024

export async function achicarFoto(archivo: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return archivo

  let imagen: ImageBitmap
  try {
    imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
  } catch {
    return archivo
  }

  try {
    const escala = Math.min(1, LADO / Math.max(imagen.width, imagen.height))
    const ancho = Math.max(1, Math.round(imagen.width * escala))
    const alto = Math.max(1, Math.round(imagen.height * escala))
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d')
    if (!ctx) return archivo
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, ancho, alto)
    ctx.drawImage(imagen, 0, 0, ancho, alto)
    return await new Promise<Blob>((resolver) => {
      lienzo.toBlob(
        (blob) => {
          resolver(blob ?? archivo)
        },
        'image/jpeg',
        0.88,
      )
    })
  } finally {
    imagen.close()
  }
}
