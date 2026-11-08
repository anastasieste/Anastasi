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
- Despliega las versiones actualizadas de `callsign-login` y `member-mail` antes de publicar GitHub Pages. La primera permite renovar sesiones iniciadas por callsign y la segunda entrega las confirmaciones de cambio de correo mediante el relay existente. Los enlaces anteriores a `solicitudes.html` abren el modal en la portada.
- El nombre, la biografía, el detalle y la actividad empiezan como privados. El correo se muestra al titular y se utiliza durante la revisión administrativa de su solicitud. Los administradores pueden corregir el callsign y el escuadrón de un miembro aprobado. Cada cambio queda registrado en `members_private.member_edits`.
- Las notas de decisión se conservan en el perfil privado y se consultan en el historial del modal. El Editor y la fuente de publicaciones aprobadas quedan pendientes de una fase posterior. Las insignias y descripciones se muestran cuando existen en los datos del escuadrón.
- Ejecuta `tests/member-profiles.sql` como postgres en un entorno de prueba después de las migraciones. Las cuentas de prueba, los avatares simulados y las decisiones se revierten al terminar.
