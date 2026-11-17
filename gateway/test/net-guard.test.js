import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpsUrl, isPrivateAddress } from '../src/net-guard.js';

test('private addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.8.201', '169.254.1.1', '100.101.234.107', '::1', 'fd00::1', '::ffff:192.168.1.1']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
});

test('server-side fetches refuse http, local names and private IPs', async () => {
  await assert.rejects(assertPublicHttpsUrl('http://example.com/a.png'));
  await assert.rejects(assertPublicHttpsUrl('https://127.0.0.1/a.png'));
  await assert.rejects(assertPublicHttpsUrl('https://192.168.8.201:3300/media/x'));
  await assert.rejects(assertPublicHttpsUrl('https://localhost/x'));
  await assert.rejects(assertPublicHttpsUrl('file:///etc/passwd'));
  await assert.doesNotReject(assertPublicHttpsUrl('https://cdn.example.com/x.png', { viaProxy: true }));
});

test('provider uploads are real multipart bodies (undici FormData)', async () => {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { providerFetch, fileForm } = await import('../src/providers/http.js');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'up-')), 'a.png');
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
  const srv = http.createServer((req, res) => { let n = 0; req.on('data', (c) => { n += c.length; }); req.on('end', () => res.end(JSON.stringify({ ct: req.headers['content-type'], n }))); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await providerFetch(`http://127.0.0.1:${srv.address().port}/`, { method: 'POST', body: await fileForm('file', file, 'image/png', 'a.png') });
    const { ct, n } = await res.json();
    assert.match(ct, /^multipart\/form-data; boundary=/);
    assert.ok(n > 2048);
  } finally { srv.close(); }
});
