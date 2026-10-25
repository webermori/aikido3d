import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMesh } from '../src/ogre/mesh.js';
import { parseSkeleton } from '../src/ogre/skeleton.js';
import { parseDescription, parseMaterials, parseSrt, parseVis } from '../src/ogre/text-formats.js';

const root = process.env.AIKIDO3D_ASSETS ?? fileURLToPath(new URL('../extracted/', import.meta.url));
const has = existsSync(`${root}/Media/VisualCommon`);
const read = (p) => readFileSync(`${root}/${p}`);

test('srt and description', () => {
  const cues = parseSrt('1\r\n00:00:00,645 --> 00:00:01,970\r\nAs Uke strikes\r\n\r\n2\r\n00:00:01,971 --> 00:01:04,742\r\nslide\r\nforward\r\n');
  assert.deepEqual(cues, [{ start: 0.645, end: 1.97, text: 'As Uke strikes' }, { start: 1.971, end: 64.742, text: 'slide\nforward' }]);
  const d = parseDescription('Tachi Waza\nShomenuchi Ikkyo - Omote\nShomenuchi\nOverhead strike\nIkkyo\nFirst form\n<br/>Body');
  assert.equal(d.category, 'Tachi Waza');
  assert.equal(d.technique, 'Ikkyo');
  assert.equal(d.body, '<br/>Body');
});

test('pt-BR translations keep cue timing of the English source', () => {
  const dir = new URL('../translations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.srt'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const pt = parseSrt(readFileSync(new URL(f, dir), 'utf8'));
    const en = parseSrt(readFileSync(new URL(`en/${f}`, dir), 'utf8'));
    assert.deepEqual(pt.map(({ start, end }) => [start, end]), en.map(({ start, end }) => [start, end]), f);
    assert.ok(pt.every((c) => c.text.trim()), `${f}: empty cue`);
  }
});

test('material and vis', () => {
  const m = parseMaterials('material a\n{\n technique\n {\n  pass\n  {\n   diffuse 0.5 0.5 0.5 1\n   scene_blend alpha_blend\n   depth_write off\n   texture_unit\n   {\n    texture x.dds\n   }\n  }\n }\n}\nmaterial b\n{\n}\n');
  assert.deepEqual(m.a.diffuse, [0.5, 0.5, 0.5, 1]);
  assert.equal(m.a.texture, 'x.dds');
  assert.equal(m.a.alphaBlend, true);
  assert.equal(m.a.depthWrite, false);
  assert.equal(m.b.texture, null);
  assert.deepEqual(parseVis('#c\nstart_set="s" mode="name"\nsubmesh="x"\nend_set\n'), { s: ['x'] });
});

test('ogre mesh + skeletons share bone handles', { skip: !has && 'assets not extracted' }, () => {
  const mesh = parseMesh(read('Media/VisualCommon/DNV.mesh'));
  const base = parseSkeleton(read('Media/VisualCommon/DNV.skeleton'));
  const clip = parseSkeleton(read('Data/Clips/501/501_SHOIKYO_DNV.skeleton'));
  assert.equal(mesh.skeleton, 'DNV.skeleton');
  assert.equal(mesh.shared.attributes.position.array.length, mesh.shared.vertexCount * 3);
  assert.ok(mesh.submeshes.every((s) => s.name && s.indices.every((i) => i < mesh.shared.vertexCount)));
  assert.ok(mesh.sharedBones.every((a) => a.bone < base.bones.length));
  assert.equal(clip.bones.length, base.bones.length);
  const anim = clip.animations[0];
  assert.ok(anim.length > 1 && anim.tracks.length > 50);
  assert.ok(anim.tracks.every((t) => t.keys.every((k) => Math.abs(Math.hypot(...k.rotate) - 1) < 1e-3)), 'unit quaternions');
});
