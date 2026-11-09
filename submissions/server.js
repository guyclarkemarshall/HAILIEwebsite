/**
 * HAILIE document submissions service
 *
 * Receives uploads from share-a-document.html (via the website's Caddy
 * proxy at /api/submit), then using Microsoft Graph with app-only access:
 *   1. saves the file to the HAILIE SharePoint site, in a sub-folder per
 *      permission level,
 *   2. adds a row to a SharePoint list used as the submissions log
 *      (the list is created on first use),
 *   3. emails a notification to HAILIE and an acknowledgement to the
 *      submitter, sent from the HAILIE shared mailbox.
 *
 * No dependencies: Node 20+ only. Configuration is by environment variable,
 * see README.md in this folder.
 */
'use strict';

const http = require('node:http');

// ---- Configuration ------------------------------------------------------

const CONFIG = {
  port: Number(process.env.PORT) || 8080,
  tenantId: process.env.AZURE_TENANT_ID || '',
  clientId: process.env.AZURE_CLIENT_ID || '',
  clientSecret: process.env.AZURE_CLIENT_SECRET || '',
  // Graph site path: <hostname>:/sites/<name>
  sitePath: process.env.SHAREPOINT_SITE || 'fuzaltd.sharepoint.com:/sites/HAILIE',
  // Folder inside the site's Documents library
  folder: process.env.SHAREPOINT_FOLDER || 'Document submissions',
  listName: process.env.SHAREPOINT_LIST || 'Document submissions log',
  sender: process.env.MAIL_SENDER || 'hailie@fuza.co.uk',
  notifyEmail: process.env.NOTIFY_EMAIL || 'guy@fuza.co.uk',
  sendAcknowledgement: process.env.SEND_ACKNOWLEDGEMENT !== 'false',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://housingai.org,https://www.housingai.org')
    .split(',').map((s) => s.trim()).filter(Boolean),
  maxFileBytes: 10 * 1024 * 1024,
  // A base64 file of 10 MB plus the other fields fits comfortably in 15 MB
  maxBodyBytes: 15 * 1024 * 1024,
  allowedExtensions: ['pdf', 'doc', 'docx'],
  // Simple per-IP limit to slow down abuse
  rateLimit: { windowMs: 10 * 60 * 1000, max: 5 },
};

const USE_FOLDERS = {
  'Publish openly with attribution (CC BY-SA 4.0)': '1 - Publish with attribution',
  'Publish openly, anonymised': '2 - Publish anonymised (needs sign-off)',
  'Share with HAILIE community members only': '3 - Members only',
  'HAILIE internal use only (inform guidance, do not share document)': '4 - Internal use only',
};

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// SharePoint list columns (internal name, display name, type)
const LIST_COLUMNS = [
  ['SubmittedBy', 'Submitted by', 'text'],
  ['Email', 'Email', 'text'],
  ['Organisation', 'Organisation', 'text'],
  ['Role', 'Role', 'text'],
  ['DocumentType', 'Document type', 'text'],
  ['DocumentStatus', 'Status', 'text'],
  ['Description', 'Description', 'note'],
  ['Permission', 'Permission', 'text'],
  ['Conditions', 'Conditions', 'note'],
  ['AuthorityConfirmed', 'Authority confirmed', 'text'],
  ['PrivacyConfirmed', 'Privacy confirmed', 'text'],
  ['FileName', 'File name', 'text'],
  ['FileSizeKB', 'File size (KB)', 'number'],
  ['FileLink', 'File link', 'note'],
];

const GRAPH = 'https://graph.microsoft.com/v1.0';

// ---- Microsoft Graph helpers --------------------------------------------

let tokenCache = { value: '', expires: 0 };

async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expires - 60_000) return tokenCache.value;
  if (!CONFIG.tenantId || !CONFIG.clientId || !CONFIG.clientSecret) {
    throw new Error('Microsoft app credentials are not configured');
  }
  const res = await fetch(`https://login.microsoftonline.com/${CONFIG.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Token request failed: ${data.error_description || res.status}`);
  tokenCache = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return tokenCache.value;
}

async function graph(method, path, body, extraHeaders) {
  const token = await getToken();
  const res = await fetch(path.startsWith('https://') ? path : GRAPH + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
  });
  if (res.status === 202 || res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error.code)) || res.status;
    const err = new Error(`Graph ${method} ${path.split('?')[0]} failed: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let siteIdCache = '';
async function getSiteId() {
  if (!siteIdCache) siteIdCache = (await graph('GET', `/sites/${CONFIG.sitePath}?$select=id`)).id;
  return siteIdCache;
}

let listIdCache = '';
async function getListId() {
  if (listIdCache) return listIdCache;
  const siteId = await getSiteId();
  const lists = await graph('GET', `/sites/${siteId}/lists?$select=id,displayName&$top=200`);
  const found = (lists.value || []).find((l) => l.displayName === CONFIG.listName);
  if (found) {
    listIdCache = found.id;
    return listIdCache;
  }
  const created = await graph('POST', `/sites/${siteId}/lists`, {
    displayName: CONFIG.listName,
    list: { template: 'genericList' },
    columns: LIST_COLUMNS.map(([name, displayName, type]) => ({
      name,
      displayName,
      ...(type === 'number' ? { number: {} } : { text: type === 'note' ? { allowMultipleLines: true } : {} }),
    })),
  });
  listIdCache = created.id;
  return listIdCache;
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function uploadFile(relativePath, bytes) {
  const siteId = await getSiteId();
  const itemPath = `/sites/${siteId}/drive/root:/${encodePath(relativePath)}:`;

  // Small files: a single PUT. Graph creates any missing folders.
  if (bytes.length <= 4 * 1024 * 1024) {
    return graph('PUT', `${itemPath}/content?@microsoft.graph.conflictBehavior=rename`, bytes,
      { 'Content-Type': 'application/octet-stream' });
  }

  // Larger files: an upload session, in chunks that are multiples of 320 KiB.
  const session = await graph('POST', `${itemPath}/createUploadSession`, {
    item: { '@microsoft.graph.conflictBehavior': 'rename' },
  });
  const chunk = 320 * 1024 * 10;
  let result = null;
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(start + chunk, bytes.length);
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(end - start),
        'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}`,
      },
      body: bytes.subarray(start, end),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`Upload session chunk failed: ${res.status} ${await res.text()}`);
    }
    if (res.status === 200 || res.status === 201) result = await res.json();
  }
  return result;
}

async function sendMail({ to, replyTo, subject, body }) {
  await graph('POST', `/users/${encodeURIComponent(CONFIG.sender)}/sendMail`, {
    message: {
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
      ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {}),
    },
    saveToSentItems: true,
  });
}

// ---- Submission handling ------------------------------------------------

const str = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);

function validate(p) {
  const required = ['name', 'email', 'organisation', 'document_title', 'document_type', 'data_use'];
  for (const key of required) {
    if (!str(p[key])) return `Missing required field: ${key}`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(p.email))) return 'Invalid email address';
  if (p.confirm_authority !== 'Yes' || p.confirm_privacy !== 'Yes') return 'Both confirmations are required';
  if (!USE_FOLDERS[p.data_use]) return 'Please choose how HAILIE may use the document';
  if (!p.file || !p.file.name || !p.file.data) return 'No file received';
  const ext = String(p.file.name).split('.').pop().toLowerCase();
  if (!CONFIG.allowedExtensions.includes(ext)) return 'Only PDF and Word documents are accepted';
  return null;
}

// Check the file really is what its extension says
function contentMatches(ext, bytes) {
  const head = bytes.subarray(0, 8);
  const hex = Buffer.from(head).toString('hex');
  if (ext === 'pdf') return Buffer.from(head.subarray(0, 4)).toString('latin1') === '%PDF';
  if (ext === 'docx') return hex.startsWith('504b0304');
  if (ext === 'doc') return hex.startsWith('d0cf11e0a1b11ae1');
  return false;
}

const cleanForPath = (s) => str(s, 120).replace(/["*:<>?/\\|#%\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();

async function handleSubmission(p) {
  const problem = validate(p);
  if (problem) return { status: 400, body: { ok: false, error: problem } };

  const ext = String(p.file.name).split('.').pop().toLowerCase();
  const bytes = new Uint8Array(Buffer.from(String(p.file.data), 'base64'));
  if (!bytes.length) return { status: 400, body: { ok: false, error: 'The file is empty' } };
  if (bytes.length > CONFIG.maxFileBytes) {
    return { status: 413, body: { ok: false, error: 'File is larger than 10 MB' } };
  }
  if (!contentMatches(ext, bytes)) {
    return { status: 400, body: { ok: false, error: 'The file does not look like a valid PDF or Word document' } };
  }

  const fields = {
    name: str(p.name, 200),
    email: str(p.email, 254),
    organisation: str(p.organisation, 200),
    role: str(p.role, 200),
    title: str(p.document_title, 250),
    type: str(p.document_type, 200),
    status: str(p.document_status, 100),
    description: str(p.description, 5000),
    permission: p.data_use,
    conditions: str(p.use_conditions, 2000),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = cleanForPath(String(p.file.name).replace(/\.[^.]+$/, '')) || 'document';
  const fileName = `${stamp} - ${cleanForPath(fields.organisation) || 'Unknown'} - ${baseName}.${ext}`;
  const subFolder = USE_FOLDERS[fields.permission];

  // 1. Save the file. If this fails the submission fails.
  const item = await uploadFile(`${CONFIG.folder}/${subFolder}/${fileName}`, bytes);
  const fileUrl = item && item.webUrl ? item.webUrl : '';
  const savedName = item && item.name ? item.name : fileName;
  const sizeKb = Math.max(1, Math.round(bytes.length / 1024));

  // 2. Log it. The file is already safe, so a logging failure is reported
  //    in the notification email rather than failing the submission.
  let logProblem = '';
  try {
    const siteId = await getSiteId();
    const listId = await getListId();
    await graph('POST', `/sites/${siteId}/lists/${listId}/items`, {
      fields: {
        Title: fields.title,
        SubmittedBy: fields.name,
        Email: fields.email,
        Organisation: fields.organisation,
        Role: fields.role,
        DocumentType: fields.type,
        DocumentStatus: fields.status,
        Description: fields.description,
        Permission: fields.permission,
        Conditions: fields.conditions,
        AuthorityConfirmed: 'Yes',
        PrivacyConfirmed: 'Yes',
        FileName: savedName,
        FileSizeKB: sizeKb,
        FileLink: fileUrl,
      },
    });
  } catch (err) {
    logProblem = String(err.message || err);
    console.error('Logging to SharePoint list failed:', logProblem);
  }

  // 3. Emails. Failures are logged, not shown to the submitter, because
  //    the document has been received.
  try {
    await sendMail({
      to: CONFIG.notifyEmail,
      replyTo: fields.email,
      subject: `HAILIE document submission: ${fields.title}`,
      body:
        'A new document has been submitted via housingai.org.\n\n' +
        `Title:        ${fields.title}\n` +
        `Type:         ${fields.type}${fields.status ? ` (${fields.status})` : ''}\n` +
        `From:         ${fields.name}${fields.role ? `, ${fields.role}` : ''}\n` +
        `Organisation: ${fields.organisation}\n` +
        `Email:        ${fields.email}\n\n` +
        `PERMISSION:   ${fields.permission}\n` +
        (fields.conditions ? `Conditions:   ${fields.conditions}\n` : '') +
        (fields.description ? `\nDescription:\n${fields.description}\n` : '') +
        `\nFile: ${savedName} (${sizeKb} KB)\n${fileUrl}\n` +
        (logProblem ? `\nNOTE: the submission could not be added to the "${CONFIG.listName}" list: ${logProblem}\n` : ''),
    });
  } catch (err) {
    console.error('Notification email failed:', err.message || err);
  }

  if (CONFIG.sendAcknowledgement) {
    try {
      await sendMail({
        to: fields.email,
        subject: 'Thank you for sharing a document with HAILIE',
        body:
          `Hello ${fields.name},\n\n` +
          `Thank you for sharing "${fields.title}" with HAILIE.\n\n` +
          `We have recorded your permission as: ${fields.permission}.\n` +
          (fields.conditions ? `Conditions noted: ${fields.conditions}\n` : '') +
          '\nA HAILIE volunteer will review it and be in touch. If you want to change ' +
          'how the document is used, or withdraw it, reply to this email.\n\n' +
          'HAILIE — Housing AI Leadership & Implementation Exchange\n' +
          'https://housingai.org\n',
      });
    } catch (err) {
      console.error('Acknowledgement email failed:', err.message || err);
    }
  }

  console.log(`Saved submission "${fields.title}" from ${fields.organisation} as ${savedName}`);
  return { status: 200, body: { ok: true } };
}

// ---- HTTP server ----------------------------------------------------------

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < CONFIG.rateLimit.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > CONFIG.rateLimit.max;
}

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (origin && CONFIG.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...(CONFIG.allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (req.method === 'GET' && path === '/health') {
    if (url.searchParams.get('deep') !== '1') return send(res, 200, { ok: true, service: 'HAILIE document submissions' }, origin);
    // Deep check: can we get a token and see the site? Used after setup.
    const checks = {};
    try { await getToken(); checks.token = 'ok'; } catch (e) { checks.token = e.message; }
    try { await getSiteId(); checks.site = 'ok'; } catch (e) { checks.site = e.message; }
    return send(res, checks.token === 'ok' && checks.site === 'ok' ? 200 : 500,
      { ok: checks.token === 'ok' && checks.site === 'ok', checks }, origin);
  }

  if (req.method !== 'POST' || path !== '/submit') return send(res, 404, { ok: false, error: 'Not found' }, origin);

  if (origin && !CONFIG.allowedOrigins.includes(origin)) {
    return send(res, 403, { ok: false, error: 'Origin not allowed' }, origin);
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) {
    return send(res, 429, { ok: false, error: 'Too many submissions, please try again later' }, origin);
  }

  // Read the body with a size cap
  const chunks = [];
  let size = 0;
  let tooBig = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > CONFIG.maxBodyBytes) { tooBig = true; break; }
    chunks.push(chunk);
  }
  if (tooBig) return send(res, 413, { ok: false, error: 'File is larger than 10 MB' }, origin);

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return send(res, 400, { ok: false, error: 'Invalid request' }, origin);
  }

  // Honeypot filled in: a bot. Pretend everything is fine.
  if (payload && payload._gotcha) return send(res, 200, { ok: true }, origin);

  try {
    const result = await handleSubmission(payload || {});
    return send(res, result.status, result.body, origin);
  } catch (err) {
    console.error('Submission failed:', err.message || err);
    return send(res, 500, { ok: false, error: 'Something went wrong while saving the document.' }, origin);
  }
});

server.requestTimeout = 120_000;

if (require.main === module) {
  // '::' listens on IPv6 and IPv4, which Railway private networking needs
  server.listen(CONFIG.port, '::', () => {
    console.log(`HAILIE submissions service listening on ${CONFIG.port}`);
  });
}

module.exports = { server, CONFIG, validate, contentMatches, cleanForPath };
