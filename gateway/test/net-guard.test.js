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
