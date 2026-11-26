import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { apimart } from '../src/providers/apimart.js';
import { slugBase } from '../src/projects.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let files;
let app;
let dataDir;
const cookies = {};
const original = { submit: apimart.submit, poll: apimart.poll, upload: apimart.upload, quote: apimart.quote, actualCost: apimart.actualCost };

const cookieOf = (res) => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw[0] : raw).split(';')[0];
};
const as = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: cookies[who] }, ...(payload !== undefined ? { payload } : {}) });

function multipart(filename, mime, data) {
  const boundary = '----dz' + Date.now();
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

before(async () => {
  files = http.createServer((req, res) => { res.setHeader('content-type', 'image/png'); res.end(PNG); });
  await new Promise((r) => files.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-prj-'));
  fs.mkdirSync(path.join(dataDir, 'catalog'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'catalog', 'apimart-models.json'), JSON.stringify({
    fetchedAt: Date.now(), list: [{ id: 'test-image', category: 'image', capability_tags: ['Text to Image'] }],
  }));
  apimart.submit = async () => ({ taskId: 'task_1' });
  apimart.poll = async () => ({ state: 'processing' });
  apimart.quote = async () => null;
  apimart.upload = async () => ({ url: 'https://cdn.apimart.example/ref.png', expiresAt: Date.now() + 86_400_000 });

  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: 'http://127.0.0.1:9', dataDir, appSecret: 'test', sessionDays: 30, logLevel: 'error',
    startWorkers: false, testAllowLocalDownloads: true,
    providerEnv: { apimart: { apiKey: 'sk-test', proxy: '' }, atlas: { apiKey: '', proxy: '' } },
  }, { logger: false });
  await app.ready();
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  let res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'admin', displayName: 'Admin', password: 'admin-pass-1', setupCode } });
  cookies.admin = cookieOf(res);
  for (const u of ['wife', 'kid']) {
    await as('admin', 'POST', '/dz/api/settings/people', { username: u, name: u, password: `${u}-pass-123` });
    res = await app.inject({ method: 'POST', url: '/login', payload: { username: u, password: `${u}-pass-123` } });
    cookies[u] = cookieOf(res);
  }
});

after(async () => {
  Object.assign(apimart, original);
  await app.close();
  files.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const generate = (who, dz = {}) => as(who, 'POST', '/api/v1/p/apimart/test-image?m=t2i', { prompt: 'a cat', _dz: { studio: 'create', ...dz } });

let project;
let folder;
let projGen;
let personalGen;
let wifeGen;

test('slugs: Cyrillic names become readable Latin', () => {
  assert.equal(slugBase('Свадьба Ани'), 'svadba-ani');
  assert.equal(slugBase('!!!'), 'project');
});

test('create a project; the owner is its first member; others do not see it', async () => {
  let res = await as('admin', 'POST', '/dz/api/projects', { name: 'Family Trip' });
  assert.equal(res.statusCode, 200, res.body);
  project = res.json().project;
  assert.equal(project.slug, 'family-trip');
  assert.equal(project.role, 'owner');
  assert.match(project.color, /^#[0-9a-f]{6}$/);
  res = await as('wife', 'GET', `/dz/api/projects/${project.id}`);
  assert.equal(res.statusCode, 404);
  res = await as('wife', 'GET', '/dz/api/projects');
  assert.deepEqual(res.json().projects, []);
  // A second project with the same name gets its own slug.
  res = await as('admin', 'POST', '/dz/api/projects', { name: 'Family Trip' });
  assert.notEqual(res.json().project.slug, 'family-trip');
});

test('folders nest; a folder cannot go inside itself', async () => {
  let res = await as('admin', 'POST', `/dz/api/projects/${project.id}/folders`, { name: 'Locations' });
  assert.equal(res.statusCode, 200, res.body);
  folder = res.json().folder;
  res = await as('admin', 'POST', `/dz/api/projects/${project.id}/folders`, { name: 'Beach', parent: folder.id });
  const child = res.json().folder;
  res = await as('admin', 'PATCH', `/dz/api/folders/${folder.id}`, { parent: child.id });
  assert.equal(res.statusCode, 409);
  res = await as('wife', 'POST', `/dz/api/projects/${project.id}/folders`, { name: 'Nope' });
  assert.equal(res.statusCode, 404);
});

test('generate into a project folder and into personal', async () => {
  let res = await generate('admin', { project: project.slug, folder: folder.id });
  assert.equal(res.statusCode, 200, res.body);
  projGen = res.json().id;
  res = await generate('admin');
  personalGen = res.json().id;
  // Someone who is not a member can't put work into the project.
  res = await generate('wife', { project: project.id });
  assert.equal(res.statusCode, 404);
  // A folder from another project is refused.
  res = await generate('admin', { project: project.id, folder: 'fld_nope' });
  assert.equal(res.statusCode, 404);

  res = await as('admin', 'GET', `/api/v1/history?project=${project.id}`);
  assert.deepEqual(res.json().items.map((i) => i.id), [projGen]);
  assert.equal(res.json().items[0].folder_id, folder.id);
  res = await as('admin', 'GET', `/api/v1/history?project=${project.id}&folder=root`);
  assert.equal(res.json().items.length, 0);
  res = await as('admin', 'GET', `/api/v1/history?project=${project.id}&folder=fld_other`);
  assert.equal(res.statusCode, 404);
  res = await as('admin', 'GET', '/api/v1/history?project=none');
  assert.deepEqual(res.json().items.map((i) => i.id), [personalGen]);
  res = await as('admin', 'GET', '/api/v1/history');
  assert.equal(res.json().items.length, 2);
});

test('members see the project and its work, never personal history', async () => {
  let res = await as('admin', 'POST', `/dz/api/projects/${project.id}/members`, { username: 'wife' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().members.map((m) => m.username).sort(), ['admin', 'wife']);
  res = await as('wife', 'GET', '/dz/api/projects');
  assert.equal(res.json().projects[0].id, project.id);
  assert.equal(res.json().projects[0].role, 'member');

  res = await as('wife', 'GET', '/api/v1/history');
  assert.deepEqual(res.json().items.map((i) => i.id), [projGen]);
  assert.equal(res.json().items[0].mine, false);
  assert.equal(res.json().items[0].author, 'Admin');
  res = await as('wife', 'GET', `/api/v1/predictions/${personalGen}/result`);
  assert.equal(res.statusCode, 404);
  res = await as('kid', 'GET', `/api/v1/predictions/${projGen}/result`);
  assert.equal(res.statusCode, 404);
  // Members can like project work, but only the author or the owner can trash it.
  res = await as('wife', 'POST', `/api/v1/predictions/${projGen}/like`, { liked: true });
  assert.equal(res.statusCode, 200);
  res = await as('wife', 'DELETE', `/api/v1/predictions/${projGen}/media`);
  assert.equal(res.statusCode, 403);
  // Members can't manage the project.
  res = await as('wife', 'PATCH', `/dz/api/projects/${project.id}`, { name: 'Mine now' });
  assert.equal(res.statusCode, 403);
  res = await as('wife', 'POST', `/dz/api/projects/${project.id}/members`, { username: 'kid' });
  assert.equal(res.statusCode, 403);
});

test('uploads in a project are shared with its members', async () => {
  const mp = multipart('ref.png', 'image/png', PNG);
  let res = await app.inject({ method: 'POST', url: `/api/v1/upload_file?project=${project.id}`, headers: { cookie: cookies.admin, ...mp.headers }, payload: mp.payload });
  assert.equal(res.statusCode, 200, res.body);
  const url = res.json().url;
  res = await as('wife', 'GET', url);
  assert.equal(res.statusCode, 200);
  res = await as('kid', 'GET', url);
  assert.equal(res.statusCode, 404);
  res = await as('wife', 'GET', `/api/v1/uploads?project=${project.id}`);
  assert.equal(res.json().items.length, 1);
  // A member can use it as a reference in the project.
  res = await as('wife', 'POST', '/api/v1/p/apimart/test-image?m=t2i', { prompt: 'x', image_urls: [url], _dz: { project: project.id } });
  assert.equal(res.statusCode, 200, res.body);
  wifeGen = res.json().id;
});

test('move to another place: author only, and only into own projects', async () => {
  let res = await as('wife', 'POST', `/api/v1/predictions/${projGen}/move`, { project: null });
  assert.equal(res.statusCode, 403);
  res = await as('admin', 'POST', `/api/v1/predictions/${personalGen}/move`, { project: project.id, folder: folder.id });
  assert.equal(res.statusCode, 200, res.body);
  res = await as('wife', 'GET', `/api/v1/history?project=${project.id}&folder=${folder.id}`);
  assert.equal(res.json().items.length, 2);
  res = await as('admin', 'POST', `/api/v1/predictions/${personalGen}/move`, { project: null });
  assert.equal(res.json().project_id, null);
});

test('copy to another place: new item with its own files, free; batch move/trash/restore; search by prompt', async () => {
  // Finish the personal job so it has a file.
  apimart.poll = async () => ({ state: 'completed', outputs: [`http://127.0.0.1:${files.address().port}/out.png`], costUsd: 0.02 });
  app.ctx.db.prepare('UPDATE generations SET next_poll_at = 0 WHERE id = ?').run(personalGen);
  await app.ctx.generations.tick();
  apimart.poll = async () => ({ state: 'processing' });
  let res = await as('admin', 'POST', `/api/v1/predictions/${personalGen}/copy`, { project: project.id, folder: folder.id });
  assert.equal(res.statusCode, 200, res.body);
  const copyId = res.json().id;
  assert.notEqual(copyId, personalGen);
  res = await as('wife', 'GET', `/api/v1/history?project=${project.id}&folder=${folder.id}`);
  const copied = res.json().items.find((i) => i.id === copyId);
  assert.ok(copied, 'members see the copy');
  assert.equal(copied.cost_usd, 0);
  assert.equal(copied.meta.copiedFrom, personalGen);
  assert.equal(copied.mine, false);
  const orig = app.ctx.db.prepare('SELECT outputs_json FROM generations WHERE id = ?').get(personalGen);
  const copy = app.ctx.db.prepare('SELECT outputs_json FROM generations WHERE id = ?').get(copyId);
  assert.notEqual(JSON.parse(orig.outputs_json)[0].path, JSON.parse(copy.outputs_json)[0].path);
  assert.ok(fs.existsSync(JSON.parse(copy.outputs_json)[0].path));
  // The original stays where it was (personal).
  res = await as('admin', 'GET', '/api/v1/history?project=none');
  assert.ok(res.json().items.some((i) => i.id === personalGen));
  // A member copies project work into their own Library; an unfinished job can't be copied.
  res = await as('wife', 'POST', `/api/v1/predictions/${copyId}/copy`, { project: null });
  assert.equal(res.statusCode, 200, res.body);
  res = await as('admin', 'POST', `/api/v1/predictions/${projGen}/copy`, { project: null });
  assert.equal(res.statusCode, 409);
  // Someone outside can't copy personal work.
  res = await as('kid', 'POST', `/api/v1/predictions/${personalGen}/copy`, { project: null });
  assert.equal(res.statusCode, 404);

  // Batch: each item on its own.
  res = await as('wife', 'POST', '/api/v1/predictions/batch', { action: 'move', ids: [copyId, projGen], project: project.id, folder: null });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().done.length, 0, 'wife is the author of neither');
  assert.equal(res.json().failed.length, 2);
  res = await as('admin', 'POST', '/api/v1/predictions/batch', { action: 'move', ids: [copyId, projGen], project: project.id, folder: null });
  assert.deepEqual(res.json().done.sort(), [copyId, projGen].sort());
  res = await as('admin', 'POST', '/api/v1/predictions/batch', { action: 'trash', ids: [copyId] });
  assert.deepEqual(res.json().done, [copyId]);
  res = await as('admin', 'POST', '/api/v1/predictions/batch', { action: 'restore', ids: [copyId] });
  assert.deepEqual(res.json().done, [copyId]);
  res = await as('admin', 'POST', '/api/v1/predictions/batch', { action: 'nope', ids: [copyId] });
  assert.equal(res.statusCode, 400);
  res = await as('admin', 'POST', '/api/v1/predictions/batch', { action: 'move', ids: [] });
  assert.equal(res.statusCode, 400);

  // Search by words in the prompt; % and _ are plain characters.
  res = await as('admin', 'GET', `/api/v1/history?project=${project.id}&q=CAT`);
  assert.ok(res.json().items.length >= 2);
  res = await as('admin', 'GET', `/api/v1/history?project=${project.id}&q=dog`);
  assert.equal(res.json().items.length, 0);
  res = await as('admin', 'GET', `/api/v1/history?project=${project.id}&q=%25`);
  assert.equal(res.json().items.length, 0);
  // Not only ASCII: Cyrillic in any case.
  res = await as('admin', 'POST', '/api/v1/p/apimart/test-image?m=t2i', { prompt: 'Кот в ШЛЯПЕ', _dz: { studio: 'create' } });
  assert.equal(res.statusCode, 200, res.body);
  res = await as('admin', 'GET', `/api/v1/history?project=none&q=${encodeURIComponent('шляпе')}`);
  assert.equal(res.json().items.length, 1);
});

test('a reference file named with spaces reaches the provider under a safe name', async () => {
  const { payload, headers } = multipart('My bar photo 1.png', 'image/png', PNG);
  let res = await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { ...headers, cookie: cookies.admin }, payload });
  assert.equal(res.statusCode, 200, res.body);
  const url = res.json().url;
  const seen = [];
  const prev = apimart.upload;
  apimart.upload = async (cfg, f) => { seen.push(f.name); return { url: 'https://cdn.apimart.example/My bar photo 1.png', expiresAt: Date.now() + 86_400_000 }; };
  const sent = [];
  const prevSubmit = apimart.submit;
  apimart.submit = async (cfg, { body }) => { sent.push(body); return { taskId: 'task_sp' }; };
  try {
    res = await as('admin', 'POST', '/api/v1/p/apimart/test-image?m=t2i', { prompt: 'x', image_urls: [url], _dz: { studio: 'create' } });
    assert.equal(res.statusCode, 200, res.body);
  } finally { apimart.upload = prev; apimart.submit = prevSubmit; }
  assert.ok(seen.length && !/\s/.test(seen[0]), `uploaded as ${seen[0]}`);
  assert.equal(sent[0].image_urls[0], 'https://cdn.apimart.example/My bar photo 1.png', 'the test stub skips the provider wrapper');
});

test('deleting a folder keeps its work (moves up); archive stops new work', async () => {
  let res = await as('admin', 'DELETE', `/dz/api/folders/${folder.id}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(!res.json().folders.some((f) => f.id === folder.id));
  res = await as('admin', 'GET', `/api/v1/history?project=${project.id}&folder=root`);
  assert.ok(res.json().items.some((i) => i.id === projGen), 'work from the deleted folder is now at the project root');
  res = await as('admin', 'PATCH', `/dz/api/projects/${project.id}`, { archived: true });
  assert.equal(res.json().project.archived, true);
  res = await generate('admin', { project: project.id });
  assert.equal(res.statusCode, 409);
});

test('a member can leave; the owner cannot', async () => {
  const wife = (await as('admin', 'GET', `/dz/api/projects/${project.id}`)).json().members.find((m) => m.username === 'wife');
  let res = await as('wife', 'DELETE', `/dz/api/projects/${project.id}/members/${wife.id}`);
  assert.equal(res.json().left, true);
  res = await as('wife', 'GET', `/api/v1/predictions/${projGen}/result`);
  assert.equal(res.statusCode, 404);
  // Her own work in the project stays with the project.
  res = await as('wife', 'GET', `/api/v1/predictions/${wifeGen}/result`);
  assert.equal(res.statusCode, 404);
  res = await as('wife', 'GET', '/api/v1/history');
  assert.ok(!res.json().items.some((i) => i.id === wifeGen));
  const admin = (await as('admin', 'GET', `/dz/api/projects/${project.id}`)).json().members.find((m) => m.username === 'admin');
  res = await as('admin', 'DELETE', `/dz/api/projects/${project.id}/members/${admin.id}`);
  assert.equal(res.statusCode, 409);
});

test('elements: personal and project, copies both ways with their own files', async () => {
  // A fresh project for this test (the first one is archived by now).
  let res = await as('admin', 'POST', '/dz/api/projects', { name: 'Elements test' });
  const proj = res.json().project;
  await as('admin', 'POST', `/dz/api/projects/${proj.id}/members`, { username: 'wife' });
  const mp = multipart('hero.png', 'image/png', PNG);
  res = await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { cookie: cookies.admin, ...mp.headers }, payload: mp.payload });
  const personalUpload = res.json().url;

  // Personal element: only the owner.
  res = await as('admin', 'POST', '/dz/api/elements', { name: 'Hero', kind: 'character', description: 'Tall', images: [personalUpload] });
  assert.equal(res.statusCode, 200, res.body);
  const hero = res.json().element;
  assert.equal(hero.images[0], personalUpload); // already a personal upload: reused
  res = await as('wife', 'PATCH', `/dz/api/elements/${hero.id}`, { name: 'Mine' });
  assert.equal(res.statusCode, 404);
  res = await as('admin', 'POST', '/dz/api/elements', { name: '', images: [personalUpload] });
  assert.equal(res.statusCode, 400);
  res = await as('admin', 'POST', '/dz/api/elements', { name: 'Empty' });
  assert.equal(res.statusCode, 400);
  // Someone else's file can't be put into an element.
  res = await as('wife', 'POST', '/dz/api/elements', { name: 'Steal', images: [personalUpload] });
  assert.equal(res.statusCode, 404);

  // Copy into the project: new files that members can open.
  res = await as('admin', 'POST', `/dz/api/elements/${hero.id}/copy`, { project: proj.id });
  assert.equal(res.statusCode, 200, res.body);
  const inProject = res.json().element;
  assert.equal(inProject.project_id, proj.id);
  assert.equal(inProject.source_id, hero.id);
  assert.notEqual(inProject.images[0], personalUpload);
  res = await as('wife', 'GET', inProject.images[0]);
  assert.equal(res.statusCode, 200);
  res = await as('wife', 'GET', personalUpload);
  assert.equal(res.statusCode, 404);
  res = await as('wife', 'GET', `/dz/api/elements?project=${proj.id}`);
  assert.deepEqual(res.json().elements.map((e) => e.id), [inProject.id]);
  res = await as('kid', 'GET', `/dz/api/elements?project=${proj.id}`);
  assert.equal(res.statusCode, 404);

  // Edits don't reach the other copy.
  res = await as('wife', 'PATCH', `/dz/api/elements/${inProject.id}`, { name: 'Hero (trip)' });
  assert.equal(res.json().element.name, 'Hero (trip)');
  res = await as('admin', 'GET', '/dz/api/elements');
  assert.equal(res.json().elements.find((e) => e.id === hero.id).name, 'Hero');

  // A member copies the project element into her own Library.
  res = await as('wife', 'POST', `/dz/api/elements/${inProject.id}/copy`, { project: null });
  assert.equal(res.statusCode, 200, res.body);
  const hers = res.json().element;
  assert.equal(hers.project_id, null);
  res = await as('wife', 'GET', hers.images[0]);
  assert.equal(res.statusCode, 200);
  res = await as('admin', 'GET', hers.images[0]);
  assert.equal(res.statusCode, 404);

  // Delete: author or project owner; the member is not the author of the project copy.
  res = await as('wife', 'DELETE', `/dz/api/elements/${inProject.id}`);
  assert.equal(res.statusCode, 403);
  res = await as('admin', 'DELETE', `/dz/api/elements/${inProject.id}`);
  assert.equal(res.statusCode, 200);
  res = await as('wife', 'GET', `/dz/api/elements?project=${proj.id}`);
  assert.equal(res.json().elements.length, 0);
});

test('elements v2: tags, labelled views and videos, draft, duplicate, update from Library, generated video joins the element', async () => {
  let res = await as('admin', 'POST', '/dz/api/projects', { name: 'Elements v2' });
  const proj = res.json().project;
  const up = async (name) => {
    const mp = multipart(name, 'image/png', PNG);
    const r = await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { cookie: cookies.admin, ...mp.headers }, payload: mp.payload });
    return r.json().url;
  };
  const a = await up('a.png');
  const b = await up('b.png');
  res = await as('admin', 'POST', '/dz/api/elements', { name: 'Майк', kind: 'character', views: [{ url: a, label: 'Front' }, { url: b, label: '3/4 left' }], status: 'draft', notes: '180 cm' });
  assert.equal(res.statusCode, 200, res.body);
  const mike = res.json().element;
  assert.equal(mike.tag, 'char_mayk');
  assert.deepEqual(mike.views.map((v) => v.label), ['Front', '3/4 left']);
  assert.deepEqual(mike.images, [a, b]);
  assert.equal(mike.status, 'draft');
  assert.equal(mike.notes, '180 cm');
  // The same name gets the next free tag; a taken tag is refused; a bad tag too.
  res = await as('admin', 'POST', '/dz/api/elements', { name: 'Майк', kind: 'character', views: [a] });
  assert.equal(res.json().element.tag, 'char_mayk_2');
  res = await as('admin', 'PATCH', `/dz/api/elements/${res.json().element.id}`, { tag: 'char_mayk' });
  assert.equal(res.statusCode, 409);
  res = await as('admin', 'PATCH', `/dz/api/elements/${mike.id}`, { tag: 'img1' });
  assert.equal(res.statusCode, 400, 'attachment names (@img1, @start…) are not element tags');
  res = await as('admin', 'PATCH', `/dz/api/elements/${mike.id}`, { tag: '1 bad' });
  assert.equal(res.statusCode, 400);
  res = await as('admin', 'PATCH', `/dz/api/elements/${mike.id}`, { tag: '@char_mike', status: 'active', views: [{ url: b, label: 'Main now' }, { url: a, label: 'Front' }] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().element.tag, 'char_mike');
  assert.equal(res.json().element.images[0], b);
  // Too long a description.
  res = await as('admin', 'PATCH', `/dz/api/elements/${mike.id}`, { description: 'x'.repeat(401) });
  assert.equal(res.statusCode, 400);

  // Duplicate in place; copy to a project keeps the tag there; update from Library.
  res = await as('admin', 'POST', `/dz/api/elements/${mike.id}/copy`, { duplicate: true });
  assert.equal(res.json().element.name, 'Майк copy');
  assert.equal(res.json().element.source_id, null);
  res = await as('admin', 'POST', `/dz/api/elements/${mike.id}/copy`, { project: proj.id });
  const copy = res.json().element;
  assert.equal(copy.tag, 'char_mike');
  res = await as('admin', 'PATCH', `/dz/api/elements/${mike.id}`, { name: 'Mike', notes: 'new notes' });
  res = await as('admin', 'POST', `/dz/api/elements/${copy.id}/sync`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().element.name, 'Mike');
  assert.equal(res.json().element.notes, 'new notes');
  assert.equal(res.json().element.tag, 'char_mike');
  res = await as('admin', 'POST', `/dz/api/elements/${mike.id}/sync`);
  assert.equal(res.statusCode, 409);

  // A generation made for the element: its video becomes a labelled video of it — once.
  apimart.poll = async () => ({ state: 'completed', outputs: [`http://127.0.0.1:${files.address().port}/clip.mp4`], costUsd: 0.1 });
  res = await as('admin', 'POST', '/api/v1/p/apimart/test-image?m=t2i', { prompt: 'turn', _dz: { studio: 'create', meta: { forElement: { id: copy.id, label: 'Turnaround' } } } });
  assert.equal(res.statusCode, 200, res.body);
  const genId = res.json().id;
  app.ctx.db.prepare('UPDATE generations SET next_poll_at = 0 WHERE id = ?').run(genId);
  await app.ctx.generations.tick();
  apimart.poll = async () => ({ state: 'processing' });
  await new Promise((r) => setTimeout(r, 50));
  // The test model makes pictures: a picture is never added as a video.
  res = await as('admin', 'GET', `/dz/api/elements?project=${proj.id}`);
  assert.equal(res.json().elements.find((e) => e.id === copy.id).videos.length, 0);
  // As a real video job (kind and file type), it is added, and only once.
  const row = app.ctx.db.prepare('SELECT outputs_json FROM generations WHERE id = ?').get(genId);
  const outs = JSON.parse(row.outputs_json).map((o) => ({ ...o, mime: 'video/mp4', ext: o.ext }));
  app.ctx.db.prepare("UPDATE generations SET kind = 'video', outputs_json = ? WHERE id = ?").run(JSON.stringify(outs), genId);
  await app.ctx.elements.attachPending();
  await app.ctx.elements.attachPending();
  res = await as('admin', 'GET', `/dz/api/elements?project=${proj.id}`);
  const got = res.json().elements.find((e) => e.id === copy.id);
  assert.equal(got.videos.length, 1);
  assert.equal(got.videos[0].label, 'Turnaround');
  assert.equal(got.videos[0].from, genId);
  assert.match(got.videos[0].url, /^\/media\/u\//);
  assert.equal(got.video, got.videos[0].url);
  // Someone who can't edit the element can't push a video into it.
  const wifeGen = app.ctx.db.prepare('SELECT * FROM generations WHERE id = ?').get(genId);
  await app.ctx.elements.attachGenerated({ ...wifeGen, id: 'gen_other', user_id: app.ctx.db.prepare("SELECT id FROM users WHERE username = 'kid'").get().id });
  res = await as('admin', 'GET', `/dz/api/elements?project=${proj.id}`);
  assert.equal(res.json().elements.find((e) => e.id === copy.id).videos.length, 1);
});

test('uploads can be deleted by their uploader, not by others, and not while an element shows them', async () => {
  const up = async (who, name) => {
    const mp = multipart(name, 'image/png', PNG);
    const r = await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { cookie: cookies[who], ...mp.headers }, payload: mp.payload });
    return r.json().url;
  };
  const a = await up('admin', 'scribble.png');
  const b = await up('admin', 'keep.png');
  const idOf = (url) => url.split('/').pop().split('.')[0];
  let res = await as('admin', 'POST', '/dz/api/elements', { name: 'Keeper', views: [b] });
  assert.equal(res.statusCode, 200, res.body);
  res = await as('wife', 'POST', '/api/v1/uploads/delete', { ids: [idOf(a)] });
  assert.deepEqual(res.json().done, []);
  // In the Library, "all" lists personal elements and those of every project I'm in.
  res = await as('admin', 'GET', '/dz/api/elements?project=all');
  const all = res.json().elements;
  assert.ok(all.some((e) => !e.project_id) && all.some((e) => e.project_id && e.project_name));
  res = await as('kid', 'GET', '/dz/api/elements?project=all');
  assert.ok(res.json().elements.every((e) => !e.project_id || e.project_name));
  assert.equal(res.json().elements.some((e) => e.name === 'Keeper'), false);
  res = await as('admin', 'POST', '/api/v1/uploads/delete', { ids: [idOf(a), idOf(b)] });
  assert.deepEqual(res.json().done, [idOf(a)]);
  assert.match(res.json().failed[0].error, /Keeper/);
  res = await as('admin', 'GET', a);
  assert.equal(res.statusCode, 404);
  res = await as('admin', 'GET', b);
  assert.equal(res.statusCode, 200);
});
