import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { TIFFLoader } from 'three/addons/loaders/TIFFLoader.js';
import { unzipSync } from 'fflate';
import { parseMesh } from '../ogre/mesh.js';
import { parseSkeleton } from '../ogre/skeleton.js';
import { parseDescription, parseIni, parseMaterials, parseSrt, parseVis } from '../ogre/text-formats.js';
import { createCharacter, createClip, findBone } from './three-ogre.js';

const $ = (id) => document.getElementById(id);
const asset = (p) => `aikido://assets/${p.split('/').map(encodeURIComponent).join('/')}`;
const bytes = async (p) => { const r = await fetch(asset(p)); if (!r.ok) throw new Error(`${p}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
const text = async (p) => new TextDecoder('windows-1252').decode(await bytes(p));
const ROLES = ['DNV', 'LUI', 'STP', 'TN1']; // nage, uke, footsteps, tanto
const HAKAMA_SETS = { true: 'hakama_no_center_no_sphere', false: 'no_hakama_no_center_no_sphere' };

// ---------- scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2d33);
const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
camera.position.set(0, 160, 520);
scene.add(camera);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 90, 0);
controls.enableDamping = true;

const floor = new THREE.Mesh(new THREE.CircleGeometry(600, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8a8070 }));
floor.receiveShadow = true;
scene.add(floor);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas.parentElement;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);

const rgb = (s) => new THREE.Color(...s.split(',').map((v) => +v / 255));
const vec = (s) => new THREE.Vector3(...s.split(',').map(Number));

async function setupLights() {
  const ini = parseIni(await text('Data/Lights.ini'));
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const main = ini.MainLight, second = ini.SecondaryLight;
  const sun = new THREE.DirectionalLight(rgb(main.DiffuseColour), 2.2);
  sun.position.copy(vec(main.Position));
  sun.castShadow = main.CastShadows === 'true';
  Object.assign(sun.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300, far: +main.ShadowFarDistance || 800 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const fill = new THREE.PointLight(rgb(second.DiffuseColour), 0.8, 0, 0);
  if (second.AttachToCamera === 'true') camera.add(fill); else { fill.position.copy(vec(second.Position)); scene.add(fill); }
}

// ---------- materials ----------
const dds = new DDSLoader(), tiff = new TIFFLoader();
const textures = new Map(), materials = new Map(), materialDefs = new Map();

function texture(dir, name) {
  const key = `${dir}/${name}`;
  if (!textures.has(key)) {
    const loader = name.toLowerCase().endsWith('.tif') ? tiff : dds;
    // Ogre UVs are top-left origin, matching the row order of DDS/TIFF data, so no flipY.
    const t = loader.load(asset(key), undefined, undefined, () => console.warn('texture failed', key));
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    textures.set(key, t);
  }
  return textures.get(key);
}

async function loadMaterials(dir, files) {
  for (const f of files) {
    for (const [name, def] of Object.entries(parseMaterials(await text(`${dir}/${f}`)))) materialDefs.set(name, { ...def, dir });
  }
}

function material(name) {
  if (!materials.has(name)) {
    const d = materialDefs.get(name);
    materials.set(name, new THREE.MeshLambertMaterial({
      color: d ? new THREE.Color(...d.diffuse.slice(0, 3)) : 0xaaaaaa,
      map: d?.texture ? texture(d.dir, d.texture) : null,
      side: THREE.DoubleSide, // Ogre materials use cull_hardware none
      transparent: !!d?.alphaBlend,
      depthWrite: d ? d.depthWrite : true,
      alphaTest: d?.alphaReject ? 0.5 : 0,
    }));
  }
  return materials.get(name);
}

// ---------- characters ----------
const chars = {};
const env = {};

async function loadCharacter(role) {
  const dir = 'Media/VisualCommon';
  const [mesh, skel, cfg] = await Promise.all([
    bytes(`${dir}/${role}.mesh`).then(parseMesh),
    bytes(`${dir}/${role}.skeleton`).then(parseSkeleton),
    text(`${dir}/${role}.cfg`).then(parseIni),
  ]);
  const visCfg = cfg.VisibilityEffect;
  const vis = visCfg ? parseVis(await text(`${dir}/${visCfg.filename}`)) : {};
  const c = createCharacter(mesh, skel, { material, hidden: vis[visCfg?.setName] ?? [] });
  c.group.visible = false;
  c.mixer = new THREE.AnimationMixer(c.group);
  Object.assign(c, { vis, skel, role });
  scene.add(c.group);
  chars[role] = c;
}

async function loadDojo() {
  const mesh = parseMesh(await bytes('Media/VisualFullRoom/env.mesh'));
  env.dojo = createCharacter(mesh, null, { material }).group;
  scene.add(env.dojo);
}

function applyHakama() {
  const on = $('opt-hakama').checked;
  for (const c of Object.values(chars)) {
    const set = c.vis[HAKAMA_SETS[on]];
    if (set) c.setHidden(set);
  }
}

// ---------- clips ----------
let clips = [];
let current = null;
const player = { time: 0, duration: 0, playing: false, speed: 1 };
const voice = new Audio(), announce = new Audio();

async function loadClipIndex(list) {
  clips = await Promise.all(list.map(async ({ id, files }) => {
    const zipName = files.find((f) => f.toLowerCase() === `${id}.zip`);
    let meta = { title: id, category: 'Other' }, subtitles = [];
    if (zipName) {
      const zip = unzipSync(await bytes(`Data/Clips/${id}/${zipName}`));
      const dec = new TextDecoder('windows-1252');
      const desc = Object.keys(zip).find((k) => /_Description\.txt$/i.test(k));
      const srt = Object.keys(zip).find((k) => /\.srt$/i.test(k));
      if (desc) meta = parseDescription(dec.decode(zip[desc]));
      if (srt) subtitles = parseSrt(dec.decode(zip[srt]));
    }
    const skeletons = {};
    for (const f of files) {
      const m = f.match(/_([A-Z0-9]+)\.skeleton$/i);
      if (m) skeletons[m[1].toUpperCase()] = f;
    }
    const pick = (re) => files.find((f) => re.test(f));
    return { id, files, ...meta, subtitles, skeletons, nameAudio: pick(/_Name\.ogg$/i), voiceAudio: pick(/_Voiceover_EN\.ogg$/i) };
  }));
  renderClipList();
}

function renderClipList() {
  const q = $('search').value.trim().toLowerCase();
  const nav = $('clips');
  nav.replaceChildren();
  const groups = Map.groupBy(clips.filter((c) => !q || `${c.id} ${c.title} ${c.category} ${c.attack} ${c.technique}`.toLowerCase().includes(q)), (c) => c.category);
  for (const [cat, list] of groups) {
    const h = document.createElement('h2');
    h.textContent = cat;
    nav.append(h);
    for (const c of list) {
      const b = document.createElement('button');
      b.dataset.id = c.id;
      b.setAttribute('aria-current', String(c === current));
      const small = document.createElement('small');
      small.textContent = c.id;
      b.append(small, c.title);
      b.onclick = () => selectClip(c);
      nav.append(b);
    }
  }
}

// Description bodies only use <br/> and <term>; everything else is rendered as text.
function renderBody(body) {
  const esc = body.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return esc.replace(/\n/g, ' ').replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/&lt;term&gt;(.*?)&lt;\/term&gt;/gi, '<span class="term">$1</span>');
}

function renderInfo(c) {
  const info = $('info');
  info.innerHTML = `<div class="cat"></div><h2></h2><dl><dt>Attack</dt><dd class="a"></dd><dt>Technique</dt><dd class="t"></dd></dl><div class="body"></div>`;
  info.querySelector('.cat').textContent = c.category;
  info.querySelector('h2').textContent = c.title;
  info.querySelector('.a').textContent = [c.attack, c.attackInfo].filter(Boolean).join(' — ');
  info.querySelector('.t').textContent = [c.technique, c.techniqueInfo].filter(Boolean).join(' — ');
  info.querySelector('.body').innerHTML = renderBody(c.body ?? '');
}

async function audioUrl(p) { return p ? URL.createObjectURL(new Blob([await bytes(p)], { type: 'audio/ogg' })) : ''; }

let loadToken = 0;
async function selectClip(c) {
  const token = ++loadToken;
  setPlaying(false);
  current = c;
  renderClipList();
  renderInfo(c);
  const anims = await Promise.all(ROLES.map(async (role) => {
    const f = c.skeletons[role];
    return f && chars[role] ? [role, parseSkeleton(await bytes(`Data/Clips/${c.id}/${f}`))] : [role, null];
  }));
  const [voiceSrc, nameSrc] = await Promise.all([audioUrl(c.voiceAudio && `Data/Clips/${c.id}/${c.voiceAudio}`), audioUrl(c.nameAudio && `Data/Clips/${c.id}/${c.nameAudio}`)]);
  if (token !== loadToken) return;

  player.duration = 0;
  for (const [role, skel] of anims) {
    const ch = chars[role];
    if (!ch) continue;
    ch.mixer.stopAllAction();
    ch.mixer.uncacheRoot(ch.group);
    ch.group.visible = !!skel && (role !== 'STP' || $('opt-steps').checked);
    ch.active = !!skel;
    if (!skel) continue;
    const clip = createClip(skel, ch);
    ch.mixer.clipAction(clip).play();
    player.duration = Math.max(player.duration, clip.duration);
  }
  for (const a of [voice, announce]) if (a.src) URL.revokeObjectURL(a.src);
  voice.src = voiceSrc;
  announce.src = nameSrc;
  seek(0);
  applyCameraPreset($('camera').value);
  if ($('opt-name').checked && nameSrc) {
    // Resolve on error too, or a failed announcement would block playback.
    await announce.play().then(() => new Promise((r) => { announce.onended = announce.onerror = r; }), () => {});
  }
  if (token === loadToken) setPlaying(true);
}

// ---------- playback ----------
function seek(t) {
  player.time = Math.min(Math.max(t, 0), player.duration);
  for (const c of Object.values(chars)) if (c.active) c.mixer.setTime(player.time);
  if (voice.src) voice.currentTime = player.time;
}

function setPlaying(on) {
  if (on && player.time >= player.duration) seek(0);
  player.playing = on && player.duration > 0;
  $('play').textContent = player.playing ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  voice.playbackRate = player.speed;
  voice.muted = !$('opt-voice').checked;
  if (player.playing && voice.src) { voice.currentTime = player.time; voice.play().catch(() => {}); } else voice.pause();
}

function updateHud() {
  $('time').textContent = `${player.time.toFixed(2)} / ${player.duration.toFixed(2)}`;
  if (document.activeElement !== $('timeline')) $('timeline').value = player.duration ? (player.time / player.duration) * 1000 : 0;
  const cue = $('opt-subs').checked && current?.subtitles.find((s) => player.time >= s.start && player.time < s.end);
  $('subtitle').textContent = cue ? cue.text : '';
}

// ---------- camera ----------
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let rootBones = [], headBone = null;

function centre(out) {
  out.set(0, 0, 0);
  const active = rootBones.filter((r) => r.char.group.visible);
  for (const r of active) out.add(r.bone.getWorldPosition(tmp2));
  return active.length ? out.divideScalar(active.length) : out;
}

function applyCameraPreset(mode) {
  controls.enabled = mode !== 'pov';
  scene.updateMatrixWorld(true);
  const c = centre(new THREE.Vector3()).setY(90);
  const presets = { front: [0, 70, 430], side: [430, 70, 0], top: [0, 560, 1], follow: [0, 70, 430] };
  if (presets[mode]) { camera.position.copy(c).add(tmp.set(...presets[mode])); controls.target.copy(c); }
  camera.fov = mode === 'pov' ? 85 : 45;
  camera.updateProjectionMatrix();
}

function updateCamera() {
  const mode = $('camera').value;
  if (mode === 'follow') {
    const step = centre(tmp).setY(90).sub(controls.target).multiplyScalar(0.08);
    controls.target.add(step);
    camera.position.add(step);
  } else if (mode === 'pov' && headBone) {
    // fps_view.cfg fallback for donovanO_RIG:head: X0 Y-10 Z-15; that rig's head looks down local -Z.
    headBone.updateWorldMatrix(true, false);
    camera.position.copy(headBone.localToWorld(tmp.set(0, -10, -15)));
    camera.lookAt(headBone.localToWorld(tmp2.set(0, -10, -115)));
    return;
  }
  controls.update();
}

// ---------- loop ----------
const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = timer.getDelta();
  if (player.playing) {
    let t = player.time + dt * player.speed;
    if (t >= player.duration) {
      if ($('loop').checked) { t %= player.duration; if (voice.src) voice.currentTime = t; }
      else { t = player.duration; setPlaying(false); }
    }
    player.time = t;
    for (const c of Object.values(chars)) if (c.active) c.mixer.setTime(t);
  }
  updateHud();
  updateCamera();
  renderer.render(scene, camera);
});

// ---------- UI wiring ----------
$('play').onclick = () => setPlaying(!player.playing);
$('restart').onclick = () => { seek(0); setPlaying(player.playing); };
$('timeline').oninput = (e) => { seek((e.target.value / 1000) * player.duration); if (player.playing) setPlaying(true); };
$('speed').onchange = (e) => { player.speed = +e.target.value; voice.playbackRate = player.speed; };
$('camera').onchange = (e) => applyCameraPreset(e.target.value);
$('search').oninput = renderClipList;
$('opt-voice').onchange = (e) => { voice.muted = !e.target.checked; };
$('opt-dojo').onchange = (e) => { if (env.dojo) env.dojo.visible = e.target.checked; floor.visible = !e.target.checked || !env.dojo; };
$('opt-steps').onchange = (e) => { if (chars.STP) chars.STP.group.visible = e.target.checked && chars.STP.active; };
$('opt-hakama').onchange = applyHakama;
$('choose').onclick = async () => { if (await window.aikido.chooseAssets()) location.reload(); };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'search') return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!player.playing); }
  else if (e.code === 'Home') seek(0);
  else if (e.code === 'ArrowRight') { setPlaying(false); seek(player.time + 1 / 30); }
  else if (e.code === 'ArrowLeft') { setPlaying(false); seek(player.time - 1 / 30); }
});

function showOverlay(msg) { $('overlay-msg').textContent = msg; $('overlay').hidden = false; }

async function boot() {
  const { root, clips: list } = await window.aikido.info();
  if (!root) return showOverlay('Select the folder extracted from Aikido3D_Volume_One.exe (it contains Data and Media).');
  showOverlay('Loading…');
  $('choose').hidden = true;
  await loadMaterials('Media/VisualFull', ['DNV.material', 'LUI.material', 'STP.material', 'TN1.material', 'meshes_common.material']);
  await loadMaterials('Media/VisualFullRoom', ['env.material']);
  await Promise.all([setupLights(), ...ROLES.map(loadCharacter), loadDojo().catch((e) => console.warn('dojo', e)), loadClipIndex(list)]);
  floor.visible = !env.dojo;
  rootBones = ['DNV', 'LUI'].map((r) => chars[r] && { char: chars[r], bone: findBone(chars[r].skel, chars[r], 'root') }).filter((r) => r?.bone);
  headBone = chars.DNV && findBone(chars.DNV.skel, chars.DNV, 'Head_JNT', 'head');
  $('overlay').hidden = true;
  if (clips[0]) selectClip(clips[0]);
}

boot().catch((e) => { console.error(e); showOverlay(`Failed to load assets: ${e.message}`); $('choose').hidden = false; });
