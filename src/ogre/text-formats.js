// Minimal readers for the plain-text formats shipped next to the Ogre assets.

// Extracts the fixed-function subset Aikido3D materials use: first texture, colours, alpha blending.
export function parseMaterials(text) {
  const out = {};
  const re = /^\s*material\s+(\S+)/gm;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0, i = text.indexOf('{', re.lastIndex), start = i;
    if (i < 0) break;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) break;
    }
    const body = text.slice(start, i);
    const nums = (k) => body.match(new RegExp(`^\\s*${k}\\s+([-\\d.\\s]+)$`, 'm'))?.[1].trim().split(/\s+/).map(Number);
    out[m[1]] = {
      texture: body.match(/^\s*texture\s+(\S+)/m)?.[1] ?? null,
      diffuse: nums('diffuse') ?? [1, 1, 1, 1],
      ambient: nums('ambient') ?? [0, 0, 0, 1],
      alphaBlend: /scene_blend\s+alpha_blend/.test(body),
      depthWrite: !/depth_write\s+off/.test(body),
      alphaReject: /alpha_rejection/.test(body),
    };
    re.lastIndex = i;
  }
  return out;
}

// .vis: named sets of submesh names to hide.
export function parseVis(text) {
  const sets = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const start = l.match(/^start_set="([^"]+)"/);
    if (start) sets[cur = start[1]] = [];
    else if (l === 'end_set') cur = null;
    else if (cur) { const s = l.match(/^submesh="([^"]+)"/); if (s) sets[cur].push(s[1]); }
  }
  return sets;
}

export function parseIni(text) {
  const out = {};
  let sec = out[''] = {};
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith(';')) continue;
    const s = l.match(/^\[(.+)\]$/);
    if (s) { sec = out[s[1]] ??= {}; continue; }
    const eq = l.indexOf('=');
    if (eq > 0) sec[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
  }
  return out;
}

// <id>_EN_Description.txt: 6 header lines, then a small HTML-ish body (<br/>, <term>).
export function parseDescription(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const [category, title, attack, attackInfo, technique, techniqueInfo] = lines.map((l) => l.trim());
  return { category, title, attack, attackInfo, technique, techniqueInfo, body: lines.slice(6).join('\n').trim() };
}

const ts = (s) => { const [h, m, rest] = s.split(':'); const [sec, ms] = rest.split(/[,.]/); return +h * 3600 + +m * 60 + +sec + +ms / 1000; };

export function parseSrt(text) {
  return text.replace(/\r/g, '').split(/\n\s*\n/).map((block) => {
    const lines = block.trim().split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) return null;
    const [a, b] = lines[i].split('-->').map((s) => ts(s.trim()));
    return { start: a, end: b, text: lines.slice(i + 1).join('\n') };
  }).filter(Boolean);
}
