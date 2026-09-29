// Embeddable BuddyPoke gadget for a host page (e.g. a profile on a social
// network): one buddy doing a mood, nothing else. The host passes the buddy
// in the URL hash; for customizing and poking it embeds the full app
// (index.html?host=…) instead.
//
//   gadget.html#code=<appearance code>&mood=<mood id>
//
// The host can play a poke once, after which the buddy goes back to its mood:
//   frame.contentWindow.postMessage({ source: 'kuddes', type: 'poke', poke: <poke id>,
//     from: <code of the one who poked>, to: <code of the one poked> }, origin)
// and hears back { source: 'buddypoke', type: 'poke-start' | 'poke-end' | 'poke-unavailable', poke }.

import { BuddyPokeRenderer } from './pokerenderer.js';
import { MOODS, POKES } from './data/moods.js';
import { DEFAULT_BUDDY } from './buddy.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.hash.slice(1));
// Without WebGL the renderer can't be made: say so, instead of an endless "Loading…"
// (the Kuddes page sees "could not start" and shows its own message)
if (!document.createElement('canvas').getContext('webgl')) {
  document.getElementById('loading-text').textContent = 'BuddyPoke could not start: WebGL is not available on this computer.';
  throw new Error('WebGL not available');
}
const renderer = new BuddyPokeRenderer($('#buddy-canvas'));
const ownCode = params.get('code') || DEFAULT_BUDDY;
let ownMood = null;
let ready = false;

async function boot() {
  try {
    await renderer.load((msg) => { $('#loading-text').textContent = msg; });
    // An unreadable code falls back to the default buddy inside deserializeCompressed.
    await renderer.buddy1.deserializeCompressed(ownCode);
    $('#loading').hidden = true;
    renderer.start();
    // The stored mood may be locked (its animation is missing); fall back to the first that works
    const moods = MOODS.list.filter((m) => renderer.moodAvailable(m));
    const mood = moods.find((m) => m.id === params.get('mood')) || moods.find((m) => m.id === 'm_hppy') || moods[0];
    ownMood = mood;
    if (mood) renderer.showMood(mood.id);
    ready = true;
  } catch (e) {
    console.error(e);
    $('#loading-text').textContent = 'BuddyPoke could not start: ' + e.message;
  }
}

// ------------------------------------------------------------ pokes from the host

const tell = (type, poke) => window.parent.postMessage({ source: 'buddypoke', type, poke }, location.origin);
let playing = 0; // bumps on every new poke, so a slower earlier one doesn't take over

/** Plays a poke once with both buddies (buddy1 pokes buddy2, as in the app's history), then the mood again. */
async function playPoke(id, fromCode, toCode) {
  const poke = POKES.list.find((p) => p.id === id);
  if (!ready || !poke || !renderer.pokeAvailable(poke)) return tell('poke-unavailable', id);
  const token = ++playing;
  await renderer.buddy1.deserializeCompressed(fromCode || DEFAULT_BUDDY);
  await renderer.buddy2.deserializeCompressed(toCode || DEFAULT_BUDDY);
  if (token !== playing) return;
  renderer.showPoke(id);
  // Once: each buddy holds its last frame until the longer animation is done too
  const anims = [renderer.buddy1.animation, renderer.buddy2.animation].filter(Boolean);
  for (const a of anims) a.loop = false;
  tell('poke-start', id);
  const done = (now) => anims.every((a) => a.decoded && ((now - a.startTime) / 1000) * a.fps + a.start > a.end);
  const onFrame = async (now) => {
    if (token !== playing) return renderer.off('frame', onFrame);
    if (!done(now)) return;
    renderer.off('frame', onFrame);
    await backToMood(token);
    tell('poke-end', id);
  };
  renderer.on('frame', onFrame);
}

async function backToMood(token) {
  if (token !== playing) return;
  await renderer.buddy1.deserializeCompressed(ownCode);
  if (token !== playing) return;
  if (ownMood) renderer.showMood(ownMood.id);
}

window.addEventListener('message', (e) => {
  // Only the page that embeds this frame, on the same site
  if (e.source !== window.parent || e.origin !== location.origin) return;
  const d = e.data;
  if (d?.source !== 'kuddes' || d.type !== 'poke' || typeof d.poke !== 'string') return;
  playPoke(d.poke, typeof d.from === 'string' ? d.from : null, typeof d.to === 'string' ? d.to : null);
});

boot();
