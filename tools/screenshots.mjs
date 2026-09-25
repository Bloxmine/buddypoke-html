// Captures the README screenshots into docs/screenshots/.
//
//   npm i puppeteer-core            (anywhere on your machine)
//   python3 -m http.server 8765     (in the repo root)
//   node tools/screenshots.mjs [url] [chromium-path]
//
// Defaults: http://127.0.0.1:8765/ and /usr/bin/chromium.

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8765/';
const chrome = process.argv[3] || process.env.CHROME || '/usr/bin/chromium';
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 660, deviceScaleFactor: 1 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('document.getElementById("loading").hidden === true', { timeout: 120000 });
await sleep(1500);

const tab = async (name) => { await page.click(`.bp-tabs button[data-tab=${name}]`); await sleep(1200); };
const shot = async (name) => { await page.evaluate(() => { document.getElementById('toast').hidden = true; window.scrollTo(0, 0); }); await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('saved', name); };

// Mood: preview the first mood of the Moody category.
await page.click('#mood-cats button:nth-child(4)');
await sleep(300);
await page.click('#mood-list li:not(.locked)');
await sleep(1400);
await shot('mood');

// Friends: send a bear hug.
await tab('friends');
await page.click('#poke-list li:not(.locked)');
await page.type('#poke-comment', 'come here you!');
await page.click('#poke-send');
await sleep(1800);
await shot('friends');

// Profile with a received poke.
await page.evaluate(() => window.bpSocial.receivePoke(window.bpSocial.friends[1]));
await tab('home');
await sleep(800);
await shot('profile');

// Appearance with a custom background.
await page.evaluate(() => {
  const b = window.buddypoke.buddy1;
  b.findLayer('Bkg;Material;Pattern1').setAttribute('textureIndex', '1');
  const s = b.findLayer('Bkg;Material;Solid');
  s.setAttribute('colorIndex', '150');
  s.querySelector('texture').setAttribute('colorSelection', '150');
  b.findLayer('Bkg;Material;Pattern1Color').setAttribute('colorIndex', '60');
  b.refresh();
});
await tab('appearance');
await shot('appearance');

// Comic strip.
await tab('create');
await sleep(3500);
await shot('create');

// 3D Paper Buddies.
await page.click('#create-tabs button[data-create=paper]');
await page.click('#paper-preview');
await page.waitForFunction('document.querySelectorAll("#paper-pages figure").length > 0', { timeout: 60000 });
await sleep(500);
await shot('paper');
await page.click('#create-tabs button[data-create=comic]');

// Presets.
await tab('appearance');
await page.click('#app-presets');
await sleep(12000);
await shot('presets');
await page.keyboard.press('Escape');

// Gold shop.
await tab('gold');
await shot('gold');

await browser.close();
