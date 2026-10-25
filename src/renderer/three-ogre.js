import * as THREE from 'three';

const boneName = (handle) => `b${handle}`; // Ogre names contain ':' which PropertyBinding reserves.

function setLocal(bone, b) {
  bone.position.fromArray(b.position);
  bone.quaternion.set(b.rotation[0], b.rotation[1], b.rotation[2], b.rotation[3]);
  bone.scale.fromArray(b.scale);
}

function buildGeometry(mesh) {
  const g = mesh.shared;
  const geo = new THREE.BufferGeometry();
  const { position, normal, uv } = g.attributes;
  geo.setAttribute('position', new THREE.BufferAttribute(position.array, 3));
  if (normal) geo.setAttribute('normal', new THREE.BufferAttribute(normal.array, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv.array, 2));

  if (mesh.sharedBones.length) {
    // Keep the 4 heaviest influences per vertex and renormalize, as Ogre does.
    const per = Array.from({ length: g.vertexCount }, () => []);
    for (const a of mesh.sharedBones) per[a.vertex].push(a);
    const idx = new Uint16Array(g.vertexCount * 4), w = new Float32Array(g.vertexCount * 4);
    per.forEach((list, v) => {
      list.sort((x, y) => y.weight - x.weight).length = Math.min(list.length, 4);
      const sum = list.reduce((s, a) => s + a.weight, 0) || 1;
      list.forEach((a, k) => { idx[v * 4 + k] = a.bone; w[v * 4 + k] = a.weight / sum; });
    });
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  }

  const indices = [];
  mesh.submeshes.forEach((sm, i) => {
    geo.addGroup(indices.length, sm.indices.length, i);
    for (const x of sm.indices) indices.push(x);
  });
  geo.setIndex(indices);
  return geo;
}

/**
 * Builds a skinned character from an Ogre mesh + its linked skeleton.
 * `material(name)` returns a THREE.Material for an Ogre material name; `hidden` lists submesh names to hide.
 */
export function createCharacter(mesh, skeleton, { material, hidden = [] }) {
  const geo = buildGeometry(mesh);
  const materials = mesh.submeshes.map((sm) => material(sm.material));
  // Hidden submeshes swap to an invisible material so group indices stay aligned.
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  const mats = [...materials];
  const setHidden = (names) => {
    const hide = new Set(names);
    mesh.submeshes.forEach((sm, i) => { mats[i] = hide.has(sm.name) ? invisible : materials[i]; });
  };
  setHidden(hidden);

  const group = new THREE.Group();
  if (!skeleton) {
    const m = new THREE.Mesh(geo, mats);
    m.receiveShadow = true;
    group.add(m);
    return { group, bones: [], skinned: null, setHidden };
  }

  const bones = skeleton.bones.map((b) => { const bone = new THREE.Bone(); bone.name = boneName(b.handle); setLocal(bone, b); return bone; });
  const roots = [];
  skeleton.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent].add(bones[i]) : roots.push(bones[i])));
  roots.forEach((r) => group.add(r));
  group.updateMatrixWorld(true);
  const inverses = bones.map((b) => b.matrixWorld.clone().invert());

  const skinned = new THREE.SkinnedMesh(geo, mats);
  skinned.frustumCulled = false; // bounds come from the bind pose; animation moves far from it
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  group.add(skinned);
  skinned.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
  return { group, bones, skinned, setHidden };
}

/** Converts an Ogre clip skeleton (bind pose + delta keyframes) into an absolute-pose AnimationClip. */
export function createClip(clipSkeleton, character) {
  const anim = clipSkeleton.animations[0];
  // Untracked bones should rest at the clip's bind pose, which the deltas are relative to.
  clipSkeleton.bones.forEach((b, i) => character.bones[i] && setLocal(character.bones[i], b));
  const q = new THREE.Quaternion(), d = new THREE.Quaternion();
  const tracks = [];
  for (const t of anim.tracks) {
    const bind = clipSkeleton.bones[t.bone];
    if (!bind) continue;
    const times = t.keys.map((k) => k.time);
    const pos = [], rot = [];
    q.set(...bind.rotation);
    for (const k of t.keys) {
      pos.push(bind.position[0] + k.translate[0], bind.position[1] + k.translate[1], bind.position[2] + k.translate[2]);
      d.set(...k.rotate);
      const r = q.clone().multiply(d);
      rot.push(r.x, r.y, r.z, r.w);
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${boneName(t.bone)}.position`, times, pos));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName(t.bone)}.quaternion`, times, rot));
  }
  return new THREE.AnimationClip(anim.name, anim.length, tracks);
}

/** Returns the bone whose Ogre name (minus rig prefix) matches, for camera attachment. */
export function findBone(skeleton, character, ...names) {
  const want = names.map((n) => n.split(':').pop().toLowerCase());
  const i = skeleton.bones.findIndex((b) => want.includes(b.name.split(':').pop().toLowerCase()));
  return i >= 0 ? character.bones[i] : null;
}
