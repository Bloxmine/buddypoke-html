# BuddyPoke (HTML5 port)

The BuddyPoke 3D avatar app, ported from its original Flash SWF to plain HTML, CSS and JavaScript. It has no build step and no dependencies, and it runs in any modern browser with WebGL.

The 3D engine, texture system and animations are line-by-line ports of the decompiled ActionScript, using the model, artwork and animations embedded in the original SWF. The social side (friends, incoming pokes, gold) is simulated in the browser, because the servers it talked to are long gone.

![Changing your mood](docs/screenshots/mood.png)

## Features

| | |
| --- | --- |
| ![Friends](docs/screenshots/friends.png) | **Friends and pokes**: poke your (simulated) friends with a comment, optionally private. They poke you back, poke you on their own and change their moods. |
| ![Profile](docs/screenshots/profile.png) | **Profile and history**: pokes sent and received, gold, and the event history with *poke back*. Click any event to replay it. |
| ![Appearance](docs/screenshots/appearance.png) | **Appearance**: every original customisation option (hair, face, clothes, colours, props, vehicles) plus the customisable background. Drag the buddy to turn it around. |
| ![Create](docs/screenshots/create.png) | **Create**: a three-panel comic strip maker with camera shots and speech bubbles, saved to Pictures. |
| ![Gold](docs/screenshots/gold.png) | **Gold**: earn gold by poking, changing moods and a daily bonus, and spend it on background packs. |

It also has **Pictures** (snapshots and comics kept in your browser) and **?** (names, frame rate, texture detail, and appearance codes compatible with the original app).

## Run locally

The page loads its assets with `fetch`, so serve it over HTTP rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, and save.
3. The site appears at `https://<user>.github.io/<repo>/` after a minute. `.nojekyll` is included so the files are served as-is.

Any other static host (Netlify, Cloudflare Pages, a normal web server) works the same way: upload `index.html`, `css/`, `js/` and `assets/`.

## How it works

| Path | What |
| --- | --- |
| `js/engine/` | Port of `com.buddylabs.player`: matrix math, scene graph, Edgebreaker mesh decompression, skinning and morphs, wavelet animation decoding, and a WebGL painter's-algorithm renderer with affine texture mapping (like the Flash renderer) |
| `js/swf/` | Small SWF parser and Canvas renderer for the embedded material library (vector symbols, gradients, bitmaps, colour transforms, blend modes) |
| `js/medialib.js` | Port of `MediaLibrary.createMaterial`: layered textures with colour tints, masks and lightmaps |
| `js/buddy.js`, `js/pokerenderer.js` | Ports of `SceneObject`/`Buddy`/`SceneSetting` and `BuddyPokeRenderer` (moods, pokes, examine camera, portraits, comic stills) |
| `js/social.js` | Simulated social layer: friends, incoming pokes and poke-backs, event history, gold and the shop |
| `js/app.js`, `js/ui/` | The page UI |
| `js/data/` | Moods, pokes and customisation options, generated from the decompiled ActionScript |
| `assets/chick.bin` | The buddy content package embedded in the SWF (model, texture SWF, catalog, animations) |
| `assets/anims_v1.bin` | 94 animations recovered from the archived BuddyPoke 1.0 SWF (`buddypoke.s3.amazonaws.com/swf/1.0/BuddyPokeOrkut.swf`) |
| `assets/library.json` | Data from the texture SWF's document class (clip rects, colour matrices, lightmaps) |
| `tools/` | Extraction, data-generation and screenshot scripts |

All state (your buddy, friends, history, gold, pictures) is saved in `localStorage`, separately for each visitor.

## Known gaps

- **Locked moods and pokes**: their animations were streamed from `cache01-widget01.myspacecdn.com` and aren't in the Wayback Machine. 40 of 69 moods and 50 of 120 pokes work.
- **Scene backgrounds** for moods and pokes (café, T-rex, dance floor…) came from the same servers and are missing. The customisable background under Appearance works.
- **Social features are simulated**: friends are made up and live only in your browser. Nothing is sent anywhere.

## Rebuilding the assets

You only need this to regenerate `assets/` or `js/data/`; the repository already contains them. The scripts expect:

- the Decompiler.com output of the original SWF one level above this folder (`../binaryData`, `../scripts`);
- JPEXS FFDec output of the inner texture SWF in `extract/` (git-ignored).

```sh
node tools/dump.mjs                 # unpack chick.bin into extract/ (catalog, geometry, texture SWF, animations)
java -jar ffdec-cli.jar -export script,image,shape,sprite,binaryData,frame,symbolClass extract/chick_swf extract/chick_m.swf
python3 tools/build_library.py      # -> assets/library.json
python3 tools/build_data.py         # -> js/data/*.js
node tools/extract_v1_anims.mjs     # needs extract/old_chick.bin from the BuddyPoke 1.0 SWF -> assets/anims_v1.bin
node tools/screenshots.mjs          # needs puppeteer-core and a local server on :8765 -> docs/screenshots/
```

## Credits

BuddyPoke was created by BuddyPoke Inc.; the model, artwork and animations in `assets/` come from the original app. This project is an unofficial fan preservation effort and isn't affiliated with BuddyPoke.
