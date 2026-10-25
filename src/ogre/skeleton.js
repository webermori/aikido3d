import { Reader } from './reader.js';

const BONE = 0x2000, BONE_PARENT = 0x3000, ANIMATION = 0x4000, ANIM_BASEINFO = 0x4010,
  TRACK = 0x4100, KEYFRAME = 0x4110, ANIM_LINK = 0x5000, BLENDMODE = 0x1010;

// Parses an Ogre binary .skeleton (Serializer_v1.10 / v1.8).
// Bone chunk lengths exclude the name string, so we read sequentially instead of trusting lengths.
// Keyframes are deltas over the bind pose: pos = bind.pos + kf.translate, rot = bind.rot * kf.rotate.
export function parseSkeleton(buffer) {
  const r = new Reader(buffer);
  const version = r.header();
  const bones = [];
  const animations = [];
  while (!r.eof) {
    const c = r.chunk();
    const end = c.start + c.len;
    switch (c.id) {
      case BONE: {
        const name = r.string();
        const handle = r.u16();
        const position = r.floats(3);
        const rotation = r.floats(4); // x y z w
        const fixed = 6 + 2 + 28;
        const scale = c.len > fixed ? r.floats(3) : [1, 1, 1];
        bones[handle] = { name, handle, parent: -1, position, rotation, scale };
        break;
      }
      case BONE_PARENT: {
        const child = r.u16(), parent = r.u16();
        bones[child].parent = parent;
        break;
      }
      case ANIMATION: {
        const anim = { name: r.string(), length: r.f32(), tracks: [] };
        if (r.peekId() === ANIM_BASEINFO) { const b = r.chunk(); r.pos = b.start + b.len; }
        while (r.peekId() === TRACK) {
          r.chunk();
          const track = { bone: r.u16(), keys: [] };
          while (r.peekId() === KEYFRAME) {
            const k = r.chunk();
            const time = r.f32();
            const rotate = r.floats(4);
            const translate = r.floats(3);
            const scale = k.len >= 6 + 4 + 40 ? r.floats(3) : null;
            track.keys.push({ time, rotate, translate, scale });
          }
          anim.tracks.push(track);
        }
        animations.push(anim);
        break;
      }
      case BLENDMODE: r.u16(); break;
      case ANIM_LINK: r.pos = end; break;
      default:
        throw new Error(`Unknown skeleton chunk 0x${c.id.toString(16)} at ${c.start}`);
    }
  }
  return { version, bones, animations };
}
