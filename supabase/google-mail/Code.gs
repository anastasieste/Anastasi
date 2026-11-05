function doPost(event) {
  try {
    var raw = event && event.postData && event.postData.contents;
    if (!raw || raw.length > 18000) return mailResult_(false);
    var message = JSON.parse(raw);
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty('PORTAL_MAIL_RELAY_SECRET');
    if (!secret || !equalSecret_(secret, message.secret)) return mailResult_(false);
    if (typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(message.id)
        || typeof message.to !== 'string' || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(message.to)
        || typeof message.subject !== 'string' || !message.subject.startsWith('Anástasi · ')
        || typeof message.text !== 'string' || typeof message.html !== 'string') return mailResult_(false);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return mailResult_(false);
    try {
      var sentKey = 'sent:' + message.id;
      if (properties.getProperty(sentKey)) return mailResult_(true);
      if (MailApp.getRemainingDailyQuota() < 1) return mailResult_(false);
      MailApp.sendEmail({ to: message.to, subject: message.subject, body: message.text,
        htmlBody: message.html, name: 'Anástasi' });
      properties.setProperty(sentKey, String(Date.now()));
      pruneMailHistory_(properties);
      return mailResult_(true);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return mailResult_(false);
  }
}

function equalSecret_(expected, actual) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  var difference = 0;
  for (var i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}

function pruneMailHistory_(properties) {
  var now = Date.now();
  var lastRun = Number(properties.getProperty('mail-pruned-at') || 0);
  var day = 24 * 60 * 60 * 1000;
  if (now - lastRun < day) return;
  var values = properties.getProperties();
  Object.keys(values).forEach(function (key) {
    if (key.startsWith('sent:') && now - Number(values[key]) > 3 * day) properties.deleteProperty(key);
  });
  properties.setProperty('mail-pruned-at', String(now));
}

function mailResult_(sent) {
  return ContentService.createTextOutput(JSON.stringify({ sent: sent }))
    .setMimeType(ContentService.MimeType.JSON);
}
