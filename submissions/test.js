'use strict';
// Tests run against a fake Microsoft Graph, so no credentials are needed.
process.env.AZURE_TENANT_ID = 't';
process.env.AZURE_CLIENT_ID = 'c';
process.env.AZURE_CLIENT_SECRET = 's';

const test = require('node:test');
const assert = require('node:assert');

const calls = [];
let listExists = false;
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://[::1]') || url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  calls.push({ url, method: opts.method, body: opts.body });
  const json = (status, obj) => new Response(obj === null ? null : JSON.stringify(obj), { status });
  if (url.includes('/oauth2/v2.0/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
  if (url.includes('/sites/fuzaltd.sharepoint.com:/sites/HAILIE')) return json(200, { id: 'site1' });
  if (url.includes('/lists?$select')) return json(200, { value: listExists ? [{ id: 'list1', displayName: 'Document submissions log' }] : [] });
  if (url.endsWith('/sites/site1/lists') && opts.method === 'POST') { listExists = true; return json(201, { id: 'list1' }); }
  if (url.includes('/lists/list1/items')) return json(201, { id: '1' });
  if (url.includes('/content?')) return json(201, { name: decodeURIComponent(url.split('/').pop().split(':')[0]), webUrl: 'https://sp/file' });
  if (url.includes('/createUploadSession')) return json(200, { uploadUrl: 'https://upload/session' });
  if (url === 'https://upload/session') {
    const range = opts.headers['Content-Range'];
    const [, end, total] = range.match(/-(\d+)\/(\d+)/);
    return Number(end) + 1 === Number(total) ? json(201, { name: 'big.pdf', webUrl: 'https://sp/big' }) : json(202, {});
  }
  if (url.includes('/sendMail')) return json(202, null);
  return json(404, { error: { message: 'unexpected ' + url } });
};

const { server } = require('./server.js');

const pdf = Buffer.from('%PDF-1.4\n%%EOF');
const base = {
  name: 'Test Person', email: 'test@example.org', organisation: 'Example HA', role: 'Tester',
  document_title: 'AI policy', document_type: 'Other', data_use: 'Publish openly, anonymised',
  confirm_authority: 'Yes', confirm_privacy: 'Yes',
};

let port;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { port = server.address().port; r(); })));
test.after(() => server.close());

const post = (body, headers = {}) => realFetch(`http://127.0.0.1:${port}/api/submit`, {
  method: 'POST', body: JSON.stringify(body), headers: { Origin: 'https://housingai.org', ...headers },
}).then(async (r) => ({ status: r.status, cors: r.headers.get('access-control-allow-origin'), json: await r.json() }));

test('valid submission saves, logs and emails', async () => {
  calls.length = 0;
  const r = await post({ ...base, file: { name: 'policy.pdf', data: pdf.toString('base64') } });
  assert.deepStrictEqual(r.json, { ok: true });
  assert.strictEqual(r.cors, 'https://housingai.org');
  const upload = calls.find((c) => c.url.includes('/content?'));
  assert.match(decodeURIComponent(upload.url), /Document submissions\/2 - Publish anonymised \(needs sign-off\)\/\d{4}-\d{2}-\d{2} - Example HA - policy\.pdf/);
  assert.ok(calls.some((c) => c.url.endsWith('/sites/site1/lists') && c.method === 'POST'), 'list created');
  const item = calls.find((c) => c.url.includes('/items'));
  assert.strictEqual(JSON.parse(item.body).fields.Organisation, 'Example HA');
  const mails = calls.filter((c) => c.url.includes('/users/hailie%40fuza.co.uk/sendMail'));
  assert.strictEqual(mails.length, 2);
  assert.strictEqual(JSON.parse(mails[0].body).message.toRecipients[0].emailAddress.address, 'guy@fuza.co.uk');
  assert.strictEqual(JSON.parse(mails[1].body).message.toRecipients[0].emailAddress.address, 'test@example.org');
});

test('large file uses an upload session', async () => {
  calls.length = 0;
  const big = Buffer.concat([pdf, Buffer.alloc(6 * 1024 * 1024)]);
  const r = await post({ ...base, file: { name: 'big.pdf', data: big.toString('base64') } });
  assert.deepStrictEqual(r.json, { ok: true });
  assert.strictEqual(calls.filter((c) => c.url === 'https://upload/session').length, 2);
});

test('rejects a file that is not really a PDF', async () => {
  const r = await post({ ...base, file: { name: 'x.pdf', data: Buffer.from('hello').toString('base64') } });
  assert.strictEqual(r.status, 400);
});

test('rejects missing confirmations and bad origin', async () => {
  const r1 = await post({ ...base, confirm_privacy: '', file: { name: 'p.pdf', data: pdf.toString('base64') } });
  assert.strictEqual(r1.status, 400);
  const r2 = await post({ ...base, file: { name: 'p.pdf', data: pdf.toString('base64') } }, { Origin: 'https://evil.example' });
  assert.strictEqual(r2.status, 403);
});

test('honeypot returns ok without saving', async () => {
  calls.length = 0;
  const r = await post({ ...base, _gotcha: 'bot' });
  assert.deepStrictEqual(r.json, { ok: true });
  assert.strictEqual(calls.length, 0);
});
