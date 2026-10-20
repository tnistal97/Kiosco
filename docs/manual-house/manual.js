/* global document, window, requestAnimationFrame */
/*
 * Arma lo que depende de la pagina impresa: el pie con el numero, el indice,
 * los recortes de las capturas y las marcas naranjas (sus posiciones salen de
 * capturas/marcas.js, que escribe scripts/manual-house/capturas.ts).
 *
 * Al terminar deja en window.INFORME que paginas desbordan y que imagenes no
 * cargaron: el generador del PDF se niega a escribir uno con texto cortado.
 */
;(() => {
  'use strict'

  const PIE = 'Kiosco House · Guía para trabajar en el local'
  const paginas = Array.from(document.querySelectorAll('.pagina'))
  const total = paginas.length
  const faltan = []

  const numeroDePagina = (el) => paginas.indexOf(el.closest('.pagina')) + 1

  // Pie: todas menos la portada.
  paginas.forEach((p, i) => {
    if (p.classList.contains('portada') || p.hasAttribute('data-sin-pie')) return
    const pie = document.createElement('div')
    pie.className = 'pie'
    pie.innerHTML = `<span>${PIE}</span><span>Página ${String(i + 1)} de ${String(total)}</span>`
    p.appendChild(pie)
  })

  // Indice.
  document.querySelectorAll('[data-ir]').forEach((li) => {
    const destino = document.getElementById(li.getAttribute('data-ir'))
    const em = document.createElement('em')
    em.textContent = destino ? String(numeroDePagina(destino)) : '?'
    li.appendChild(em)
  })

  const numeros = (txt) => txt.split(',').map((n) => Number(n.trim()))

  function prepararFigura(fig) {
    const img = fig.querySelector('img')
    if (!img) return
    const marco = document.createElement('div')
    marco.className = 'marco'
    img.parentNode.insertBefore(marco, img)
    marco.appendChild(img)

    let [x, y, w, h] = [0, 0, 1, 1]
    if (fig.hasAttribute('data-recorte')) {
      ;[x, y, w, h] = numeros(fig.getAttribute('data-recorte'))
      marco.classList.add('recortado')
      marco.style.aspectRatio = String((w * img.naturalWidth) / (h * img.naturalHeight))
      img.style.width = `${String(100 / w)}%`
      img.style.left = `${String((-x / w) * 100)}%`
      img.style.top = `${String((-y / h) * 100)}%`
    }

    const clave = fig.getAttribute('data-captura')
    const marcas = (fig.getAttribute('data-marcas') ?? '').split(',').filter(Boolean)
    if (!clave || marcas.length === 0) return
    const datos = (window.MARCAS ?? {})[clave]
    marcas.forEach((nombre, i) => {
      const b = datos?.[nombre.trim()]
      if (!b) {
        faltan.push(`${clave}:${nombre}`)
        return
      }
      const izq = (b[0] - x) / w
      const arr = (b[1] - y) / h
      const caja = document.createElement('div')
      caja.className = 'marca-caja'
      caja.style.left = `calc(${String(izq * 100)}% - 0.9mm)`
      caja.style.top = `calc(${String(arr * 100)}% - 0.9mm)`
      caja.style.width = `calc(${String((b[2] / w) * 100)}% + 1.8mm)`
      caja.style.height = `calc(${String((b[3] / h) * 100)}% + 1.8mm)`
      // El numero va en la esquina de arriba a la DERECHA: a la izquierda
      // suele estar el rotulo del campo y lo tapaba. Si esa esquina queda
      // contra el borde de la imagen, se corre adentro para no cortarse.
      const der = Math.min(izq + b[2] / w, 0.975)
      const num = document.createElement('div')
      num.className = 'marca-num'
      num.textContent = String(i + 1)
      num.style.left = `calc(${String(der * 100)}% + 0.9mm)`
      num.style.top = `calc(${String(Math.max(arr, 0.035) * 100)}% - 0.9mm)`
      marco.appendChild(caja)
      marco.appendChild(num)
    })
  }

  const imagenes = Array.from(document.images)
  void Promise.all(imagenes.map((img) => img.decode().catch(() => undefined))).then(() => {
    document.querySelectorAll('figure.captura').forEach(prepararFigura)
    // Un cuadro de layout despues de los recortes, y recien ahi se mide.
    requestAnimationFrame(() => {
      const desbordes = []
      paginas.forEach((p, i) => {
        // La portada tiene una imagen que sale del borde a proposito.
        if (p.classList.contains('portada')) return
        const c = p.querySelector('.contenido') ?? p
        if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) {
          desbordes.push({ pagina: i + 1, sobra: Math.round(c.scrollHeight - c.clientHeight) })
        }
      })
      window.INFORME = {
        paginas: total,
        desbordes,
        rotas: imagenes
          .filter((img) => !img.complete || img.naturalWidth === 0)
          .map((img) => img.getAttribute('src')),
        marcasFaltantes: faltan,
      }
      document.body.setAttribute('data-listo', 'si')
    })
  })
})()
