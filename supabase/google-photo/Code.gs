// El token de solo lectura se entrega exclusivamente a la función de Supabase.
function doPost(event) {
  const expected = PropertiesService.getScriptProperties().getProperty('PHOTO_TOKEN_SECRET');
  try {
    const raw = event && event.postData && event.postData.contents;
    if (!expected || expected.length < 32 || !raw || raw.length > 256) return respond_({ ok: false });
    const supplied = JSON.parse(raw).secret;
    if (typeof supplied !== 'string' || supplied.length !== expected.length) return respond_({ ok: false });
    let difference = 0;
    for (let index = 0; index < expected.length; index++) {
      difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    return respond_(difference ? { ok: false } : { token: ScriptApp.getOAuthToken() });
  } catch (error) {
    return respond_({ ok: false });
  }
}

function verifyPhotoFolder() {
  const id = PropertiesService.getScriptProperties().getProperty('PHOTO_DRIVE_CAROUSEL');
  const folder = Drive.Files.get(id, { fields: 'name,mimeType,trashed' });
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('La carpeta del carrusel no está disponible.');
  }
  console.log(folder.name);
}

function respond_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
