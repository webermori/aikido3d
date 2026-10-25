import { Reader } from './reader.js';

const MESH = 0x3000, SUBMESH = 0x4000, SUBMESH_OP = 0x4010, SUBMESH_BONE = 0x4100, SUBMESH_TEXALIAS = 0x4200,
  GEOMETRY = 0x5000, VERTEX_DECL = 0x5100, VERTEX_ELEMENT = 0x5110, VERTEX_BUFFER = 0x5200, VERTEX_BUFFER_DATA = 0x5210,
  SKELETON_LINK = 0x6000, MESH_BONE = 0x7000, NAME_TABLE = 0xa000, NAME_ELEMENT = 0xa100;

// Ogre VertexElementType -> [component count, byte size per component, kind]
const VET = {
  0: [1, 4, 'f32'], 1: [2, 4, 'f32'], 2: [3, 4, 'f32'], 3: [4, 4, 'f32'],
  4: [4, 1, 'u8n'], 5: [1, 2, 'i16'], 6: [2, 2, 'i16'], 7: [3, 2, 'i16'], 8: [4, 2, 'i16'],
  9: [4, 1, 'u8'], 10: [4, 1, 'u8n'], 11: [4, 1, 'u8n'],
};
const SEMANTIC = { 1: 'position', 2: 'blendWeights', 3: 'blendIndices', 4: 'normal', 5: 'diffuse', 6: 'specular', 7: 'uv', 8: 'binormal', 9: 'tangent' };

function readGeometry(r, end) {
  const vertexCount = r.u32();
  const elements = [];
  const buffers = {};
  while (r.pos < end) {
    const c = r.chunk();
    if (c.id === VERTEX_DECL) {
      while (r.peekId() === VERTEX_ELEMENT) {
        r.chunk();
        elements.push({ source: r.u16(), type: r.u16(), semantic: r.u16(), offset: r.u16(), index: r.u16() });
      }
    } else if (c.id === VERTEX_BUFFER) {
      const bind = r.u16(), stride = r.u16();
      const d = r.chunk();
      if (d.id !== VERTEX_BUFFER_DATA) throw new Error('Expected vertex buffer data');
      buffers[bind] = { stride, data: r.bytes(vertexCount * stride) };
    } else {
      r.pos = c.start;
      break;
    }
  }
  const attributes = {};
  for (const e of elements) {
    const [n, size, kind] = VET[e.type] ?? [];
    if (!n) continue;
    const name = SEMANTIC[e.semantic] + (e.semantic === 7 && e.index ? e.index : '');
    const { stride, data } = buffers[e.source];
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out = new Float32Array(vertexCount * n);
    for (let v = 0; v < vertexCount; v++) {
      for (let k = 0; k < n; k++) {
        const o = v * stride + e.offset + k * size;
        out[v * n + k] = kind === 'f32' ? dv.getFloat32(o, true) : kind === 'i16' ? dv.getInt16(o, true)
          : kind === 'u8n' ? data[o] / 255 : data[o];
      }
    }
    attributes[name] = { itemSize: n, array: out };
  }
  return { vertexCount, attributes };
}

function readBoneAssignment(r) { return { vertex: r.u32(), bone: r.u16(), weight: r.f32() }; }

// Parses an Ogre binary .mesh (MeshSerializer_v1.40/1.41). Unknown chunks (LOD, edge lists, bounds, poses) are skipped.
export function parseMesh(buffer) {
  const r = new Reader(buffer);
  const version = r.header();
  const top = r.chunk();
  if (top.id !== MESH) throw new Error('Missing M_MESH chunk');
  const mesh = { version, skeletallyAnimated: r.bool(), shared: null, sharedBones: [], submeshes: [], skeleton: null };
  // M_MESH/M_SUBMESH lengths exclude their strings, so read to EOF rather than trusting them.
  while (!r.eof) {
    const c = r.chunk();
    const end = c.start + c.len;
    switch (c.id) {
      case GEOMETRY: mesh.shared = readGeometry(r, end); break;
      case SUBMESH: {
        const sm = { material: r.string(), useShared: r.bool(), name: null, bones: [] };
        const indexCount = r.u32();
        const is32 = r.bool();
        const raw = r.bytes(indexCount * (is32 ? 4 : 2));
        sm.indices = is32 ? new Uint32Array(raw.slice().buffer) : new Uint16Array(raw.slice().buffer);
        if (!sm.useShared) { const g = r.chunk(); sm.geometry = readGeometry(r, g.start + g.len); }
        while ([SUBMESH_OP, SUBMESH_BONE, SUBMESH_TEXALIAS].includes(r.peekId())) {
          const s = r.chunk();
          if (s.id === SUBMESH_OP) sm.operation = r.u16();
          else if (s.id === SUBMESH_BONE) sm.bones.push(readBoneAssignment(r));
          else r.pos = s.start + s.len;
        }
        mesh.submeshes.push(sm);
        break;
      }
      case SKELETON_LINK: mesh.skeleton = r.string(); break;
      case MESH_BONE: mesh.sharedBones.push(readBoneAssignment(r)); break;
      case NAME_TABLE:
        while (r.peekId() === NAME_ELEMENT) {
          r.chunk();
          const i = r.u16();
          mesh.submeshes[i].name = r.string();
        }
        break;
      default: r.pos = end;
    }
  }
  return mesh;
}
