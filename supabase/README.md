# Activación del Portal Miembros

GitHub Pages sirve el sitio y Supabase mantiene las cuentas, los permisos y las solicitudes. El registro requiere confirmar el correo antes de avisar a la administración. Los escuadrones muestran únicamente conteos de miembros aprobados. Las solicitudes, nombres y correos son privados.

## Conectar el servicio

- En un proyecto Supabase dedicado, aplica la migración con `supabase db push` y despliega `callsign-login` y `member-mail` con `supabase functions deploy`. Conserva la configuración de autenticación de las funciones del archivo `config.toml`.
- En Auth, configura como Site URL `https://anastasieste.github.io/Anastasi/` (incluye la barra final). Activa confirmación de correo y exige al menos 9 caracteres, mayúscula, minúscula, número y símbolo. La regla del formulario coincide con el ajuste disponible en Supabase.
- Desde el Gmail de Anástasi, crea un proyecto en [Google Apps Script](https://script.google.com/), copia el archivo `google-mail/Code.gs` y agrega en Configuración del proyecto una propiedad `PORTAL_MAIL_RELAY_SECRET` con un valor aleatorio de al menos 32 bytes. Publica como aplicación web que ejecuta con la cuenta propietaria y permite solicitudes a cualquiera. Autoriza MailApp para enviar correo. El script comprueba el secreto en cada solicitud y devuelve únicamente el resultado del envío.
- Configura `PORTAL_MAIL_URL` con la URL de la aplicación terminada en `/exec` y `PORTAL_MAIL_RELAY_SECRET` con el mismo valor en los secretos de Supabase. Gmail personal permite hasta 100 destinatarios por día mediante Apps Script. No hace falta un dominio propio.
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

Con cuentas de prueba autorizadas, verifica registro, confirmación, aviso, aprobación y rechazo, acceso por correo y callsign, recuperación e inclusión del escuadrón tras la aprobación. Verifica que un miembro normal no pueda listar ni decidir solicitudes. Comprueba que los mensajes lleguen desde el Gmail de Anástasi a una dirección externa.
