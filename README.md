# Aikido 3D — Volume One (Electron)

Electron + three.js player for the content shipped in `Aikido3D_Volume_One.exe`
(an NSIS installer for a 2012 Ogre3D/libRocket C++ app). The app reads the
original assets directly — nothing is converted or redistributed.

## Setup

1. Extract the installer (7-Zip reads NSIS):
   `7z x installer/Aikido3D_Volume_One.exe -oextracted "-x!$TEMP"`
2. `npm install`
3. `npm start` — builds the renderer with Vite and launches Electron.

The asset folder (the one containing `Data` and `Media`) is resolved from
`--assets=<dir>`, `AIKIDO3D_ASSETS`, the last folder chosen in
*File → Choose assets folder…*, or `./extracted` in the repository root.

`npm test` runs the parser tests (the asset-backed test is skipped if the
assets are missing).

## How it maps to the original

| Original (Ogre/C++)                         | Here                                          |
|---------------------------------------------|-----------------------------------------------|
| `.mesh` v1.40/1.41, `.skeleton` v1.10       | `src/ogre/mesh.js`, `src/ogre/skeleton.js`    |
| Clip skeleton animation (delta keyframes)   | `createClip` in `src/renderer/three-ogre.js`  |
| `.material`, `.vis`, `.cfg`, `Lights.ini`   | `src/ogre/text-formats.js`                    |
| Clip `NNN.zip` (description + `.srt`)       | `fflate` + `parseDescription` / `parseSrt`    |
| (added) pt-BR subtitles                     | `translations/NNN.srt`, preferred over the zip's `.srt`; English sources in `translations/en/` |
| `Media/Camera/fps_view.cfg`                 | "Nage POV" camera                             |
| libRocket UI                                | HTML/CSS in `src/renderer`                    |

Roles per clip: `DNV` (nage), `LUI` (uke), `STP` (footstep markers), `TN1` (tantō).

## Not ported

- `Data/tr.bin`, `Data/gl.bin`, `Data/Clips/VLA.mod` are encrypted and the
  original executable is wrapped by Armadillo DRM, so their contents
  (likely translations, glossary and playlist/photo mapping) are not used.
- Ribbon trails, stereoscopic modes, mirrored ("reversed") playback,
  close-up photos (`Images.bin`) and notes.
