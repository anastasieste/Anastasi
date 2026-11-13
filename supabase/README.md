# Activación del Portal Miembros

GitHub Pages sirve el sitio y Supabase mantiene las cuentas, los permisos y las solicitudes. El registro requiere confirmar el correo antes de avisar a la administración. Los escuadrones muestran únicamente conteos de miembros aprobados. Las solicitudes, nombres y correos son privados.

## Conectar el servicio

- En un proyecto Supabase dedicado, aplica la migración con `supabase db push` y despliega `callsign-login` y `member-mail` con `supabase functions deploy`. Conserva la configuración de autenticación de las funciones del archivo `config.toml`.
- En Auth, configura como Site URL `https://anastasieste.github.io/Anastasi/` (incluye la barra final). Activa confirmación de correo y exige al menos 9 caracteres, mayúscula, minúscula, número y símbolo. La regla del formulario coincide con el ajuste disponible en Supabase.
- Desde el Gmail de Anástasi, crea un proyecto en [Google Apps Script](https://script.google.com/), copia el archivo `google-mail/Code.gs` y agrega en Configuración del proyecto una propiedad `PORTAL_MAIL_RELAY_SECRET` con un valor aleatorio de al menos 32 bytes. Publica como aplicación web que ejecuta con la cuenta propietaria y permite solicitudes a cualquiera. Autoriza MailApp para enviar correo. El script comprueba el secreto en cada solicitud y devuelve únicamente el resultado del envío.
- Configura `PORTAL_MAIL_URL` con la URL de la aplicación terminada en `/exec` y `PORTAL_MAIL_RELAY_SECRET` con el mismo valor en los secretos de Supabase. Gmail personal permite hasta 100 destinatarios por día mediante Apps Script. No hace falta un dominio propio.
- Para enviar mediante Brevo, verifica el remitente y crea una clave restringida a emails transaccionales. Guarda la clave en la propiedad `BREVO_API_KEY` de Apps Script. Si el remitente verificado usa otra dirección, guarda esa dirección en `BREVO_SENDER_EMAIL`. Las respuestas se dirigen a `anastasieste@gmail.com`. Autoriza las solicitudes externas de Apps Script y comprueba un envío antes de publicar la nueva versión en el despliegue existente. Quitar `BREVO_API_KEY` devuelve el envío a MailApp.
- En Supabase Auth Hooks, habilita **Send Email** con la URL `https://<PROYECTO>.supabase.co/functions/v1/member-mail`. Guarda el secreto de firma del hook como `PORTAL_AUTH_HOOK_SECRET` en Supabase. El hook valida la firma antes de enviar los correos de confirmación y recuperación.
- Genera otro secreto de al menos 32 bytes para `PORTAL_MAIL_JOB_SECRET`. Este secreto autoriza únicamente el procesamiento de la cola de notificaciones.
- Crea un trabajo de Supabase Cron que ejecute cada minuto un POST a `/functions/v1/member-mail` con el encabezado `Authorization: Bearer <secreto>`. Guarda el secreto en Vault y consulta su valor desde el trabajo. Comprueba la cola privada en `members_private.outbox`. Cada decisión se registra una sola vez y el envío reintenta hasta seis veces.
- Completa `Página WEB/js/data/account-config.js` con la URL del proyecto sin barra final y la clave **publicable**. Los secretos de correo y la clave service role pertenecen al servidor.

## Primer administrador

Crea y confirma una cuenta de Anástasi con su correo, nombre, callsign y clan. En el SQL Editor, verifica el ID de la cuenta y sustituye el UUID indicado en ambas instrucciones. Otorga acceso solo a las personas responsables de revisar solicitudes.

```sql
begin;
update members_private.profiles
set status = 'approved', decided_at = now()
where user_id = '<UUID_VERIFICADO>';
insert into members_private.administrators (user_id)
values ('<UUID_VERIFICADO>');
commit;
```

El administrador inicia sesión en Portal Miembros y entra en **Revisar solicitudes**. El aviso de una solicitud confirmada se dirige a `anastasieste@gmail.com`. La decisión se dirige al correo confirmado del solicitante.

## Comprobación antes de activar el sitio

Con cuentas de prueba autorizadas, verifica registro, confirmación, aviso, aprobación y rechazo, acceso por correo y callsign, recuperación e inclusión del escuadrón tras la aprobación. Verifica que un miembro normal no pueda listar ni decidir solicitudes. Comprueba que los mensajes lleguen a una dirección externa y que las respuestas se dirijan al Gmail de Anástasi.

## Perfiles y directorio

- Aplica `20261108000000_member_profiles.sql` después de la migración inicial. Crea el bucket privado `member-avatars` y limita cada cuenta aprobada a una imagen propia de hasta 2 MB. Mantén activada la confirmación segura de cambio de correo en Supabase Auth.
- Despliega las versiones actualizadas de `callsign-login` y `member-mail` antes de publicar GitHub Pages. La primera permite renovar sesiones iniciadas por callsign y la segunda entrega las confirmaciones de cambio de correo mediante el relay existente. Los enlaces anteriores a `solicitudes.html` llevan al Panel Admin.
- El nombre, la biografía, el detalle y la actividad empiezan como privados. El correo se muestra al titular y se utiliza durante la revisión administrativa de su solicitud. Los administradores pueden corregir el callsign y el escuadrón de un miembro aprobado. Cada cambio queda registrado en `members_private.member_edits`.
- Las notas de decisión se conservan en el perfil privado y se consultan en el historial de solicitudes. El Editor y la fuente de publicaciones aprobadas quedan pendientes de una fase posterior. Las insignias y descripciones se muestran cuando existen en los datos del escuadrón.
- Ejecuta `tests/member-profiles.sql` como postgres en un entorno de prueba después de las migraciones. Las cuentas de prueba, los avatares simulados y las decisiones se revierten al terminar.

## Panel Admin

- Aplica `20261109000000_member_management.sql` y `20261110000000_admin_panel_notes.sql`. La página `gestion.html` usa las funciones administrativas de Supabase. Los enlaces anteriores a `solicitudes.html` conducen al panel.
- Las solicitudes pendientes se deciden en la sección superior, junto al historial. Abre una cuenta en la lista de gestión para cambiar su rol, estado o nota privada. Cada guardado valida la versión de la cuenta y registra al administrador.
- Una suspensión exige motivo y bloquea acceso, directorio, avatar y conteo del escuadrón. Selecciona **Activa** para reactivar una suspensión gestionada en el panel. Las decisiones de ingreso se procesan en **Solicitudes**.
- El desplegable usa `members_private.portal_roles`. Define los permisos de cada rol nuevo antes de usarlo. Ejecuta `tests/member-management.sql` para comprobar permisos, estados y auditoría con datos revertibles.

## Editor de video

1. Aplica `20261112000000_member_videos.sql` y `20261113000000_video_gallery_covers.sql`. Despliega `member-video` con verificación de JWT en el gateway desactivada. La función verifica la sesión y el rol para las rutas privadas. La Galería y la reproducción pública requieren un video aprobado que siga en la carpeta `Videos Aprobados`.
2. En la cuenta de Anástasi, crea un proyecto de Apps Script con `google-video/Code.gs` y su manifiesto. Ejecuta `prepareVideoFolders` y autoriza Drive. El alcance `drive.file` limita el acceso a los archivos del conector. Conserva los tres IDs devueltos y evita compartir las carpetas.
3. Configura una propiedad de Apps Script `VIDEO_TOKEN_SECRET` aleatoria de al menos 32 caracteres. Implementa el script como aplicación web ejecutada por la cuenta propietaria y accesible para cualquiera. El secreto autentica cada solicitud al conector.
4. Configura los secretos de la función: `VIDEO_DRIVE_TOKEN_URL` con la URL `/exec`, `VIDEO_DRIVE_TOKEN_SECRET` con el mismo secreto del script, los tres IDs `VIDEO_DRIVE_PENDING`, `VIDEO_DRIVE_APPROVED`, `VIDEO_DRIVE_REJECTED` y dos secretos aleatorios e independientes `VIDEO_SERVICE_SECRET` y `VIDEO_CLEANUP_SECRET`. Nunca los incluyas en Pages.
5. En Vault crea `video_cleanup_url` con la URL de `member-video/cleanup` y `video_cleanup_secret` con el mismo valor que el secreto de la función. Ejecuta `video-cleanup.sql` con Cron y pg_net activos. El trabajo por hora elimina definitivamente los videos rechazados que cumplan siete días y conserva su auditoría. También retira subidas incompletas vencidas.
6. Ejecuta `npm ci --ignore-scripts` y `node scripts/package-pages.mjs` para preparar la versión publicable. Comprueba los permisos con `tests/member-videos.sql` y verifica el flujo completo con un montaje de prueba en Drive. Los miembros con cuenta aprobada pueden editar y enviar montajes. La revisión requiere una cuenta administradora.
7. Configura `VIDEO_OUTRO_FOLDER` con el ID de `Mi unidad/Editor/Aplicar a video`. Conserva un solo `FinalVideoLogo.mp4` en esa carpeta. La función `member-video` lee el archivo con el mismo conector de solo lectura de las fotografías. El Editor lo añade al enviar a revisión y conserva la exportación local por separado.

Aplica `20261115000000_member_content.sql` antes de desplegar la función `member-video` que admite fotos. Configura `PHOTO_GALLERY_PENDING`, `PHOTO_GALLERY_APPROVED` y `PHOTO_GALLERY_REJECTED` con los IDs de `Fotos/Galería/Revisión`, `Aprobadas` y `Rechazadas`. El mismo trabajo de limpieza procesa fotos y videos rechazados a partir del séptimo día. Ejecuta `tests/member-content.sql` para comprobar sus estados y permisos con datos revertibles.

## Fotografías del sitio

1. Crea el proyecto de Apps Script con `google-photo/Code.gs` y su manifiesto. Configura las propiedades `PHOTO_DRIVE_CAROUSEL` con el ID de `Mi unidad/Fotos/Carrusel` y `PHOTO_TOKEN_SECRET` con un secreto aleatorio de al menos 32 caracteres. Ejecuta `verifyPhotoFolder` con la cuenta de Anástasi y autoriza el acceso de solo lectura. Implementa el script como aplicación web ejecutada por el propietario y accesible para cualquiera. Solo una petición con el secreto recibe un token.
2. Despliega `site-photos` con la verificación JWT del gateway desactivada. Configura los secretos `PHOTO_TOKEN_URL` (la URL `/exec`), `PHOTO_TOKEN_SECRET` (el mismo valor del script), `PHOTO_DRIVE_CAROUSEL` y `PHOTO_DRIVE_ABOUT` (el ID de `Mi unidad/Fotos/Nosotros`).
3. Sube directamente a cada carpeta privada las imágenes que quieras mostrar. El sitio las ordena por nombre de archivo y consulta las carpetas al cargar Inicio. Admite JPEG, PNG, WebP, AVIF, GIF y BMP. La función comprueba la carpeta de origen de cada imagen antes de servirla.
