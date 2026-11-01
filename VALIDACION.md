# Validación de Anástasi v1.0

Fecha: 30 de octubre de 2026.

- 40 comprobaciones del carrusel aprobadas, sin fallos, en `tests/carousel.html`.
- Listas de 0, 1, 2, 3 y 7 imágenes; tres ciclos completos por lista múltiple, vuelta inversa, teclado, gestos sintéticos, control de foco, pausa, hover y autoplay.
- Prevención de transiciones simultáneas y limpieza del componente verificadas.
- Vista de escritorio revisada a 1440 px; vistas móviles a 390 y 320 px sin desbordamiento horizontal del documento.
- Apertura del menú móvil, selección de enlace y cierre automático comprobados.
- Filtro de videos comprobado: muestra el estado vacío correspondiente.
- Sin errores ni advertencias JavaScript capturadas en las vistas revisadas.
- Recursos locales referenciados y manifest comprobados; servidor devuelve HTTP 200.
- Sintaxis JavaScript comprobada mediante `node --check`.
- Paquete `dist/` generado, con rutas relativas y sin referencias PNG/PSD ni pruebas.
- El logo original y su copia en `assets/images/branding/Logo.jpeg` coinciden con SHA-256 `78729D607811CB581701B8E53FCFDAA0C597DEB0F3CEFC30F1C474D48ADC2452`.

## Límites de esta revisión

Los gestos automatizados son eventos sintéticos; no se ha probado en un teléfono físico. Falta validar fluidez e instalación PWA en Safari/iPhone y Android reales. Se implementaron movimiento reducido, pausa al ocultar la pestaña y caché mínima; no se certificó su comportamiento en todos los navegadores ni un modo offline completo.

En la revisión inicial del 30 de octubre todavía no se había publicado el sitio. Las fotografías, los escuadrones y las publicaciones oficiales siguen pendientes. No se implementaron autenticación, administración ni Drive.


## Publicación — 1 de noviembre de 2026

- Repositorio: https://github.com/anastasieste/Anastasi
- Sitio: https://anastasieste.github.io/Anastasi/
- Despliegue inicial correcto: https://github.com/anastasieste/Anastasi/actions/runs/41351669663
- GitHub Pages configurado con GitHub Actions y HTTPS.
- Carrusel comprobado en la web pública; cambio manual de la imagen 02 a la 03 correcto.
- Sin errores ni advertencias JavaScript en la página revisada; ninguna imagen visible rota.
- Sin desbordamiento horizontal en la vista revisada de 1280 px.
- Carpeta local conectada al remoto oficial; archivos del sitio coinciden con el repositorio.
- Las credenciales de acceso no se incorporaron al código ni a la configuración del sitio.
- El despliegue emitió avisos no bloqueantes sobre la actualización del entorno de ejecución de las acciones oficiales y de ubuntu-latest; terminó con estado Success.
