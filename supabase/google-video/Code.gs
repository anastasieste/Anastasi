// Proyecto independiente. El token solo se emite a la función privada de Anástasi.
function doPost(event) {
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('VIDEO_TOKEN_SECRET');
  try {
    var raw = event && event.postData && event.postData.contents;
    if (!expected || expected.length < 32 || !raw || raw.length > 256) return response_({ ok: false });
    var supplied = JSON.parse(raw).secret;
    if (typeof supplied !== 'string' || supplied.length !== expected.length) return response_({ ok: false });
    var different = 0;
    for (var index = 0; index < expected.length; index++) {
      different |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    if (different) return response_({ ok: false });
    return response_({ token: ScriptApp.getOAuthToken() });
  } catch (error) {
    return response_({ ok: false });
  }
}

function prepareVideoFolders() {
  var props = PropertiesService.getScriptProperties();
  var definitions = {
    VIDEO_DRIVE_PENDING: 'Videos para Revisión',
    VIDEO_DRIVE_APPROVED: 'Videos Aprobados',
    VIDEO_DRIVE_REJECTED: 'Videos Rechazados'
  };
  var results = {};
  Object.keys(definitions).forEach(function (key) {
    var id = props.getProperty(key);
    if (!id) {
      var existing = Drive.Files.list({
        q: "trashed = false and 'root' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '" + definitions[key] + "'",
        fields: 'files(id,name)',
        pageSize: 10
      }).files;
      if (existing.length > 1) throw new Error('Hay más de una carpeta visible llamada ' + definitions[key]);
      id = (existing[0] || Drive.Files.create({ name: definitions[key], mimeType: 'application/vnd.google-apps.folder' })).id;
      props.setProperty(key, id);
    }
    results[key] = id;
  });
  console.log(JSON.stringify(results));
}

function response_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
