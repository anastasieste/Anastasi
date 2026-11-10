var MANAGEMENT_HEADERS = [
  'Callsign', 'Nombre', 'Correo', 'Escuadrón', 'Rol actual', 'Estado actual', 'Correo confirmado', 'Motivo vigente',
  'Nuevo callsign', 'Nuevo escuadrón', 'Nuevo rol', 'Nuevo estado', 'Motivo de suspensión', 'Aplicar',
  'ID', 'Revisión', 'Código del rol', 'Resultado'
];
var MANAGEMENT_LIMIT = 1000;

function doPost(event) {
  var lock;
  try {
    var raw = event && event.postData && event.postData.contents;
    if (!raw || raw.length > 500000) return managementReply_({ ok: false });
    var input = JSON.parse(raw);
    var properties = PropertiesService.getScriptProperties();
    if (!managementSecretMatches_(properties.getProperty('PORTAL_MANAGEMENT_SECRET'), input.secret)) {
      return managementReply_({ ok: false });
    }
    if (input.action !== 'sync' && input.action !== 'read') return managementReply_({ ok: false });
    lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) return managementReply_({ ok: false });
    var sheet = managementSheet_();
    var result = input.action === 'sync' ? syncManagement_(sheet, input.snapshot) : readManagement_(sheet);
    SpreadsheetApp.flush();
    return managementReply_({ ok: true, result: result });
  } catch (error) {
    return managementReply_({ ok: false });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function managementSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('PORTAL_MANAGEMENT_SHEET_ID');
  var sheet = SpreadsheetApp.openById(id).getSheetByName('Miembros');
  if (!sheet || sheet.getRange('A4:R4').getValues()[0].join('|') !== MANAGEMENT_HEADERS.join('|')) {
    throw new Error('La hoja no coincide con la plantilla de Anástasi.');
  }
  return sheet;
}

function prepareManagementSheet() {
  var sheet = managementSheet_();
  var protection = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).find(function (rule) {
    return rule.getDescription() === 'Registro Anástasi';
  }) || sheet.protect().setDescription('Registro Anástasi');
  if (sheet.getMaxRows() < MANAGEMENT_LIMIT + 4) sheet.insertRowsAfter(sheet.getMaxRows(), MANAGEMENT_LIMIT + 4 - sheet.getMaxRows());
  protection.setUnprotectedRanges([sheet.getRange(5, 9, MANAGEMENT_LIMIT, 6)]);
  protection.addEditor(Session.getEffectiveUser());
  var ownerEmail = Session.getEffectiveUser().getEmail();
  var otherEditors = protection.getEditors().filter(function (user) { return user.getEmail() !== ownerEmail; });
  if (otherEditors.length) protection.removeEditors(otherEditors);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  sheet.hideColumns(15, 3);
  sheet.setFrozenRows(4);
}

function readManagement_(sheet) {
  var range = managementRows_(sheet);
  var formulas = range.getFormulas();
  var rows = range.getValues();
  var proposals = [];
  rows.forEach(function (row, index) {
    if (row[13] !== true) return;
    if (formulas[index].slice(8, 14).some(Boolean)) throw new Error('Las propuestas no admiten fórmulas.');
    if (!row[14]) throw new Error('La propuesta no tiene una cuenta.');
    var draft = managementDraft_(row);
    if (!draft.callsign && !draft.squad && !draft.role && !draft.state) return;
    if (matchesManagement_(row, draft)) return;
    proposals.push({
      id: row[14], revision: row[15], expected_role: row[16], expected_state: row[5],
      expected_callsign: row[0], expected_squad: row[3],
      callsign: draft.callsign, squad: draft.squad, role_label: draft.role, state: draft.state, reason: draft.reason
    });
  });
  return proposals;
}

function syncManagement_(sheet, snapshot) {
  if (!snapshot || !Array.isArray(snapshot.members) || snapshot.members.length > MANAGEMENT_LIMIT
    || !Array.isArray(snapshot.roles) || !Array.isArray(snapshot.squads)) throw new Error('Datos de sincronización inválidos.');
  var roleLabels = new Map(snapshot.roles.map(function (role) { return [role.code, role.label]; }));
  var existing = managementRows_(sheet).getValues();
  var members = new Map(snapshot.members.map(function (member) { return [member.id, member]; }));
  var output = existing.map(function (row) {
    var member = members.get(row[14]);
    if (!member) return { current: Array(8).fill(''), meta: ['', '', '', row[14] ? 'Cuenta retirada del registro.' : ''] };
    members.delete(row[14]);
    var draft = managementDraft_(row);
    var next = currentManagement_(member, roleLabels);
    var basedOnOldState = row[15] !== member.management_revision || row[16] !== member.role
      || row[5] !== member.state || row[0] !== member.callsign || row[3] !== member.squad;
    if (basedOnOldState && (draft.callsign || draft.squad || draft.role || draft.state) && !matchesManagement_(next.current, draft)) {
      return { current: row.slice(0, 8), meta: row.slice(14, 17).concat('La cuenta cambió. Borra la propuesta y actualiza la hoja.') };
    }
    if (draft.callsign || draft.squad || draft.role || draft.state) {
      next.meta[3] = matchesManagement_(next.current, draft) ? 'Aplicado' : 'Propuesta pendiente';
    }
    return next;
  });
  var free = [];
  existing.forEach(function (row, index) {
    if (!row[14] && !row.slice(8, 13).some(Boolean) && row[13] !== true) free.push(index);
  });
  members.forEach(function (member) {
    var next = currentManagement_(member, roleLabels);
    if (free.length) output[free.shift()] = next;
    else output.push(next);
  });
  if (output.length > MANAGEMENT_LIMIT) throw new Error('Capacidad de la hoja superada.');
  sheet.getRange(5, 1, output.length, 8).setValues(output.map(function (item) {
    return item.current.map(managementLiteral_);
  }));
  sheet.getRange(5, 15, output.length, 4).setValues(output.map(function (item) { return item.meta; }));
  var labels = snapshot.roles.map(function (role) { return role.label; });
  sheet.getRange(5, 10, MANAGEMENT_LIMIT, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(snapshot.squads, true).setAllowInvalid(false).build());
  sheet.getRange(5, 11, MANAGEMENT_LIMIT, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(labels, true).setAllowInvalid(false).build());
  sheet.getRange(5, 12, MANAGEMENT_LIMIT, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['ACTIVA', 'SUSPENDIDA'], true).setAllowInvalid(false).build());
  sheet.getRange(5, 14, MANAGEMENT_LIMIT, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  return { count: snapshot.members.length };
}

function managementRows_(sheet) {
  var rows = Math.max(1, sheet.getLastRow() - 4);
  if (rows > MANAGEMENT_LIMIT) throw new Error('Capacidad de la hoja superada.');
  return sheet.getRange(5, 1, rows, 18);
}

function currentManagement_(member, roleLabels) {
  return {
    current: [member.callsign, member.full_name, member.email || '', member.squad, roleLabels.get(member.role),
      member.state, member.confirmed ? 'Sí' : 'No', member.suspension_reason || ''],
    meta: [member.id, member.management_revision, member.role, '']
  };
}

function managementDraft_(row) {
  var cells = row.slice(8, 13).map(function (value) { return String(value == null ? '' : value).trim(); });
  return { callsign: cells[0], squad: cells[1], role: cells[2], state: cells[3], reason: cells[4] };
}

function matchesManagement_(row, draft) {
  return (!draft.callsign || draft.callsign === row[0]) && (!draft.squad || draft.squad === row[3])
    && (!draft.role || draft.role === row[4]) && (!draft.state || draft.state === row[5])
    && (draft.state !== 'SUSPENDIDA' || !draft.reason || draft.reason === row[7]);
}

function managementLiteral_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function managementSecretMatches_(expected, input) {
  if (!expected || typeof input !== 'string' || expected.length !== input.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ input.charCodeAt(i);
  return diff === 0;
}

function managementReply_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
