# CLAUDE.md

HTML5 port of the BuddyPoke Flash app: plain ES modules, no build step, no runtime dependencies. The 3D engine, texture compositor and app logic are ports of the decompiled ActionScript (`com.buddylabs.player.*`, `buddypoke.render.*`).

## Run and check

- Serve the repo root over HTTP (assets load with `fetch`; `file://` does not work): `python3 -m http.server 8000`.
- There is no test suite. Verify changes in a browser, or headless with puppeteer-core + Chromium; `tools/screenshots.mjs` is a working example that drives every tab and writes `docs/screenshots/*.png`. Headless Chromium needs `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL.
- Debug handles in the page: `window.buddypoke` (the `BuddyPokeRenderer`) and `window.bpSocial` (the `Social` simulation, e.g. `bpSocial.receivePoke(bpSocial.friends[0])`).

## Architecture

- `js/engine/`: port of the Flash 3D player. `math.js` (GLMatrix), `scene.js` (Node/Scene/Camera/Mesh/Modifier/Anim/Controller), `ebdecompression.js` (Edgebreaker mesh decoding), `player.js` (Context: collects and depth-sorts triangles; Player: texture assignment, visibility, culling), `glrenderer.js` (WebGL, one draw call from a texture atlas), `canvasrenderer.js` (Canvas 2D fallback used for portraits and comic panels).
- `js/swf/`: minimal SWF parser (`swf.js`) and display-list renderer (`display.js`) for the material library SWF embedded in `assets/chick.bin`.
- `js/medialib.js`: port of `MediaLibrary.createMaterial`, which builds texture canvases from catalog `<material>` layers (symbol + colour matrix + mask + lightmap). Finished layers are cached in `layerCache`.
- `js/buddy.js`: package parsing, `SceneObject` / `Buddy` / `SceneSetting`, and the appearance-code format (custom base64 → zlib → AMF3 string → JSON).
- `js/pokerenderer.js`: port of `BuddyPokeRenderer`: mood/poke scenes, examine camera, frame loop, `portrait()` and `renderStill()`.
- `js/social.js`: simulated social layer (friends, incoming pokes, history, gold, shop, unlocked premium items), persisted under the `bp.social` localStorage key.
- `js/paper.js`: 3D Paper Buddies (port of `PaperDolls`/`PaperDollItem`): a second `Buddy` built from the paper geometry with the real buddy's `materialOptions`, rendered with the orthographic camera path at 150 DPI, laid out on pages and written to PDF.
- `js/app.js` + `js/ui/`: page UI. `ui/customize.js` is the appearance editor, `ui/widgets.js` has the popover and toast.
- `js/data/`: generated from the decompiled AS by `tools/build_data.py`. Do not hand-edit; change the generator (it also appends the Background options).
- `assets/`: `chick.bin` (content package from the July 2009 app), `anims_v1.bin` (BuddyPoke 1.0 animation library), `anims_extra.bin` (standalone CDN animations), `icons.swf` (picker thumbnails), `presets.json`, `paperbuddy.bin`, `library.json` (from `tools/build_library.py`), `icons.png` (16×16 icon sheet, 7 per row).
- Content version: the port uses the July 2009 data (`extract/v2`). The originally supplied SWF (Feb 2009) is only the source of the ported code; its data formats are identical.

## Things that are easy to get wrong

- Keep engine ports numerically faithful to the ActionScript, quirks included (e.g. `GLMatrix.copyTo` skips `m15`, `glMultMatrix` ignores row 3, `Scene.cullByName` culls region 0 for unknown names). Intentional deviations are commented at the site (e.g. meshes without dummy verts in `Mesh.init`, v1 animation handling in `Anim.draw` / `Anim.decode`).
- Rendering is the painter's algorithm with no depth buffer and affine texture mapping (screen-space coordinates, `w = 1`), like Flash. Don't "fix" it with a z-buffer; the look depends on it.
- The panel is always 346×260 logical units. Scale in the renderer, never by changing `Context.width/height` (camera `centerOffset` is in pixels).
- Material canvases are rendered at `TEXTURE_SCALE`×; UVs must use `bmd.baseWidth/baseHeight` (the Flash bitmap size), not the canvas size.
- `renderDisplayObject` leaves transforms on the context; reset with `setTransform(1,0,0,1,0,0)` before compositing (this bug once hid the trousers).
- The library artwork is drawn in pure R/G/B channels and tinted by `ColorMatrixFilter`s like `[r,1,1,0,0, g,1,0,0,0, b,1,0,0,0, 0,0,0,1,0]`. These are correct, not decompiler errors.
- 1.0 animations (`anim.lib.targets` set) have no `IG_Root` track and address the face material on `Head`; see `V1_STAGE_PLACEMENT` in `scene.js` and the remap in `Anim.decode`.
- `Anim` objects cache node references, so each buddy decodes its own copies. Never share an `Anim` between buddies.
- Appearance codes must stay compatible with the original BuddyPoke format (unknown ids are ignored by the original reader). Options can `copy` their value to other paths (colour, texture and itemGroup copies) and some selections reset other layers (`LAYER_DEPENDENCIES` in `buddy.js`); keep `Buddy.deserialize` and `CustomizePanel.apply` in sync.
- Performance on phones is dominated by texture building, not 3D rendering (a frame is ~0.5 ms). Keep `getImageData`/`putImageData` off hot paths: layer tints and masks run on the GPU (`js/gputint.js`, CPU fallback in `medialib.js`), SWF colour transforms in `display.js` go through the same tinter, and palettes read the decoded `imageData`. Friend portraits are rendered lazily in idle time and only when visible (`setFace`/`pumpFaces` in `app.js`); the renderer pauses offscreen and caps the device pixel ratio at 2.
- Premium moods/pokes carry `cost`/`pid` (coins); prices are shown ×10 in gold (`GOLD_PER_COIN` in `app.js`) and unlocked ids are stored in `social.data.owned`.

## Regenerating assets

The tools read decompiled SWFs in `extract/` (git-ignored; see `README.md` → "Rebuilding the assets"). The shipped `assets/` and `js/data/` are enough to run the app. `tools/test_*.mjs`, `anims.mjs` and `dumpold.mjs` are ad-hoc inspection scripts from the reverse-engineering work and may point at old paths.

## Style

Match the existing code: small ES modules, 2-space indent, single quotes, comments explaining *why*, and references to the original AS class/function when porting. The UI follows the classic BuddyPoke canvas look (grey gradient tabs, Verdana, rounded grey side panel); keep new UI in that style.
