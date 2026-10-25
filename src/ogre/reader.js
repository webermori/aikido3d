// Little-endian cursor over an Ogre binary serializer stream.
export class Reader {
  constructor(buffer) {
    // Normalize Node Buffers to plain Uint8Array so slice() copies instead of aliasing the pool.
    const u8 = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer);
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.pos = 0;
  }
  get eof() { return this.pos >= this.u8.byteLength; }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  bool() { return this.u8[this.pos++] !== 0; }
  floats(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = this.f32(); return a; }
  bytes(n) { const b = this.u8.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  string() {
    const end = this.u8.indexOf(0x0a, this.pos);
    if (end < 0) throw new Error(`Unterminated string at ${this.pos}`);
    const s = new TextDecoder('latin1').decode(this.u8.subarray(this.pos, end));
    this.pos = end + 1;
    return s;
  }
  chunk() { const start = this.pos; return { id: this.u16(), len: this.u32(), start }; }
  peekId() { return this.pos + 2 <= this.u8.byteLength ? this.dv.getUint16(this.pos, true) : -1; }
  header() {
    if (this.u16() !== 0x1000) throw new Error('Not an Ogre serializer stream');
    return this.string();
  }
}
