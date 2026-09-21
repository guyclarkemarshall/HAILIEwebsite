/**
 * HAILIE — document submission receiver (Google Apps Script)
 *
 * Receives submissions from share-a-document.html, saves the uploaded
 * PDF or Word file into a Google Drive folder, logs the details in a
 * Google Sheet, emails a notification to HAILIE and an acknowledgement
 * to the person who submitted it.
 *
 * Deploy as a Web App (Deploy > New deployment > Web app):
 *   Execute as:      Me
 *   Who has access:  Anyone
 * then paste the /exec URL into the form's action attribute in
 * share-a-document.html. Full steps are in README.md.
 */

// ---- Configuration ----------------------------------------------------
var CONFIG = {
  // Name of the Drive folder submissions are saved into. Created in the
  // root of your Drive on first use if it does not exist. To use an
  // existing folder instead, put its ID in FOLDER_ID.
  FOLDER_NAME: 'HAILIE document submissions',
  FOLDER_ID: '',

  // Name of the Google Sheet used as a submission log. Created inside
  // the folder above on first use. To use an existing sheet, put its
  // ID in SHEET_ID.
  SHEET_NAME: 'HAILIE document submissions log',
  SHEET_ID: '',

  // Where notification emails go. Leave blank to use the account that
  // deployed the script.
  NOTIFY_EMAIL: '',

  // Send a short acknowledgement email to the submitter.
  SEND_ACKNOWLEDGEMENT: true,

  // Limits (kept in step with the form)
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  ALLOWED_EXTENSIONS: ['pdf', 'doc', 'docx'],
};

// Subfolder per permission level so the reuse rules are obvious at a
// glance in Drive.
var USE_FOLDERS = {
  'Publish openly with attribution (CC BY-SA 4.0)': '1 - Publish with attribution',
  'Publish openly, anonymised': '2 - Publish anonymised (needs sign-off)',
  'Share with HAILIE community members only': '3 - Members only',
  'HAILIE internal use only (inform guidance, do not share document)': '4 - Internal use only',
};

var SHEET_HEADERS = [
  'Submitted', 'Name', 'Email', 'Organisation', 'Role',
  'Document title', 'Document type', 'Status', 'Description',
  'Permission', 'Conditions', 'Authority confirmed', 'Privacy confirmed',
  'File name', 'File size (KB)', 'Drive link',
];

// ---- Web app entry points ---------------------------------------------

function doGet() {
  return jsonResponse({ ok: true, service: 'HAILIE document submissions' });
}

function doPost(e) {
  try {
    var payload = parsePayload(e);

    // Honeypot filled in: a bot. Pretend everything is fine.
    if (payload._gotcha) {
      return jsonResponse({ ok: true });
    }

    var problem = validate(payload);
    if (problem) {
      return jsonResponse({ ok: false, error: problem });
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var saved = saveFile(payload);
      logToSheet(payload, saved);
      notifyHailie(payload, saved);
      if (CONFIG.SEND_ACKNOWLEDGEMENT) acknowledge(payload);
    } finally {
      lock.releaseLock();
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: 'Something went wrong while saving the document.' });
  }
}

// ---- Helpers ----------------------------------------------------------

function parsePayload(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Empty request');
  }
  return JSON.parse(e.postData.contents);
}

function validate(p) {
  var required = ['name', 'email', 'organisation', 'document_title', 'document_type', 'data_use'];
  for (var i = 0; i < required.length; i++) {
    if (!p[required[i]] || !String(p[required[i]]).trim()) {
      return 'Missing required field: ' + required[i];
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    return 'Invalid email address';
  }
  if (p.confirm_authority !== 'Yes' || p.confirm_privacy !== 'Yes') {
    return 'Both confirmations are required';
  }
  if (!p.file || !p.file.name || !p.file.data) {
    return 'No file received';
  }
  var ext = String(p.file.name).split('.').pop().toLowerCase();
  if (CONFIG.ALLOWED_EXTENSIONS.indexOf(ext) === -1) {
    return 'Only PDF and Word documents are accepted';
  }
  // Base64 is ~4/3 the size of the raw bytes
  var approxBytes = Math.floor(String(p.file.data).length * 3 / 4);
  if (approxBytes > CONFIG.MAX_FILE_BYTES) {
    return 'File is larger than ' + Math.round(CONFIG.MAX_FILE_BYTES / (1024 * 1024)) + ' MB';
  }
  return null;
}

function getRootFolder() {
  if (CONFIG.FOLDER_ID) return DriveApp.getFolderById(CONFIG.FOLDER_ID);
  var existing = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  if (existing.hasNext()) return existing.next();
  return DriveApp.createFolder(CONFIG.FOLDER_NAME);
}

function getSubFolder(parent, name) {
  var existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}

function saveFile(p) {
  var root = getRootFolder();
  var subName = USE_FOLDERS[p.data_use] || '5 - Other';
  var folder = getSubFolder(root, subName);

  var bytes = Utilities.base64Decode(p.file.data);
  var mime = p.file.type || guessMime(p.file.name);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var cleanOrg = String(p.organisation).replace(/[\\\/:*?"<>|]/g, '').trim();
  var fileName = stamp + ' - ' + cleanOrg + ' - ' + p.file.name;

  var file = folder.createFile(Utilities.newBlob(bytes, mime, fileName));
  file.setDescription(
    'Title: ' + p.document_title + '\n' +
    'Type: ' + p.document_type + '\n' +
    'From: ' + p.name + ' <' + p.email + '>, ' + p.organisation + '\n' +
    'Permission: ' + p.data_use + '\n' +
    (p.use_conditions ? 'Conditions: ' + p.use_conditions + '\n' : '')
  );

  return { file: file, folder: folder, root: root, bytes: bytes.length, fileName: fileName };
}

function guessMime(name) {
  var ext = String(name).split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function getSheet(root) {
  var ss;
  if (CONFIG.SHEET_ID) {
    ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  } else {
    var existing = root.getFilesByName(CONFIG.SHEET_NAME);
    if (existing.hasNext()) {
      ss = SpreadsheetApp.open(existing.next());
    } else {
      ss = SpreadsheetApp.create(CONFIG.SHEET_NAME);
      var f = DriveApp.getFileById(ss.getId());
      root.addFile(f);
      DriveApp.getRootFolder().removeFile(f);
    }
  }
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logToSheet(p, saved) {
  var sheet = getSheet(saved.root);
  sheet.appendRow([
    new Date(), p.name, p.email, p.organisation, p.role || '',
    p.document_title, p.document_type, p.document_status || '', p.description || '',
    p.data_use, p.use_conditions || '', p.confirm_authority, p.confirm_privacy,
    saved.fileName, Math.round(saved.bytes / 1024), saved.file.getUrl(),
  ]);
}

function notifyEmail() {
  return CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
}

function notifyHailie(p, saved) {
  var body =
    'A new document has been submitted via housingai.org.\n\n' +
    'Title:        ' + p.document_title + '\n' +
    'Type:         ' + p.document_type + (p.document_status ? ' (' + p.document_status + ')' : '') + '\n' +
    'From:         ' + p.name + (p.role ? ', ' + p.role : '') + '\n' +
    'Organisation: ' + p.organisation + '\n' +
    'Email:        ' + p.email + '\n\n' +
    'PERMISSION:   ' + p.data_use + '\n' +
    (p.use_conditions ? 'Conditions:   ' + p.use_conditions + '\n' : '') +
    (p.description ? '\nDescription:\n' + p.description + '\n' : '') +
    '\nFile: ' + saved.fileName + ' (' + Math.round(saved.bytes / 1024) + ' KB)\n' +
    saved.file.getUrl() + '\n\n' +
    'Folder: ' + saved.folder.getUrl() + '\n';

  MailApp.sendEmail({
    to: notifyEmail(),
    replyTo: p.email,
    subject: 'HAILIE document submission: ' + p.document_title,
    body: body,
  });
}

function acknowledge(p) {
  try {
    MailApp.sendEmail({
      to: p.email,
      replyTo: notifyEmail(),
      name: 'HAILIE',
      subject: 'Thank you for sharing a document with HAILIE',
      body:
        'Hello ' + p.name + ',\n\n' +
        'Thank you for sharing "' + p.document_title + '" with HAILIE.\n\n' +
        'We have recorded your permission as: ' + p.data_use + '.\n' +
        (p.use_conditions ? 'Conditions noted: ' + p.use_conditions + '\n' : '') +
        '\nA HAILIE volunteer will review it and be in touch. If you want to change ' +
        'how the document is used, or withdraw it, reply to this email.\n\n' +
        'HAILIE — Housing AI Leadership & Implementation Exchange\n' +
        'https://housingai.org\n',
    });
  } catch (err) {
    console.warn('Acknowledgement email failed: ' + err);
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
