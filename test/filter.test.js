import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackKey, byLearningOrder, matchesChips, matchesQuery, normalize } from '../src/renderer/filter.js';

const clip = { id: '501', title: 'Shomenuchi Ikkyo - Omote', category: 'Tachi Waza', attack: 'Shomenuchi', technique: 'Ikkyo' };
const kata = { id: '504', title: 'Katatetori Shiho-nage – Omote', category: 'Tachi Waza', attack: 'Katatetori', technique: 'Shiho-nage' };

test('normalize strips case, accents, spaces and hyphens', () => {
  assert.equal(normalize('Shomen-Uchi  Tantō'), 'shomenuchitanto');
});

test('matchesQuery is tolerant to spacing, hyphens, accents and aliases', () => {
  assert.ok(matchesQuery(clip, 'shomen uchi'));
  assert.ok(matchesQuery(clip, 'ikkyo omote'));
  assert.ok(!matchesQuery(clip, 'ikkyo ura'));
  assert.ok(matchesQuery(kata, 'katate dori'));
  assert.ok(matchesQuery(kata, 'shiho nage'));
  assert.ok(matchesQuery(kata, ''));
});

test('attackKey groups knife attacks', () => {
  assert.equal(attackKey('Tantotori Yokomenuchi'), 'tantotori');
  assert.equal(attackKey('Tantotori Tsuki'), 'tantotori');
  assert.equal(attackKey('Katatori Menuchi'), 'katatorimenuchi');
});

test('byLearningOrder sorts by syllabus, unknown last', () => {
  const opts = [['sumiotoshi', 'Sumi-otoshi'], ['zzz', 'Zzz'], ['sankyo', 'Sankyo'], ['ikkyo', 'Ikkyo'], ['aaa', 'Aaa'], ['nikkyo', 'Nikkyo']];
  assert.deepEqual(opts.sort(byLearningOrder('techniqueKey')).map(([k]) => k), ['ikkyo', 'nikkyo', 'sankyo', 'sumiotoshi', 'aaa', 'zzz']);
});

test('matchesChips: OR within a field, AND across fields', () => {
  const c = { techniqueKey: 'ikkyo', position: 'Omote' };
  assert.ok(matchesChips(c, new Map([['techniqueKey', new Set(['ikkyo', 'nikkyo'])], ['position', new Set()]])));
  assert.ok(!matchesChips(c, new Map([['techniqueKey', new Set(['ikkyo'])], ['position', new Set(['Ura'])]])));
});
