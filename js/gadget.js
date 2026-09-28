// Embeddable BuddyPoke gadget for a host page (e.g. a profile on a social
// network): one buddy doing a mood, nothing else. The host passes the buddy
// in the URL hash; for customizing and poking it embeds the full app
// (index.html?host=…) instead.
//
//   gadget.html#code=<appearance code>&mood=<mood id>

import { BuddyPokeRenderer } from './pokerenderer.js';
import { MOODS } from './data/moods.js';
import { DEFAULT_BUDDY } from './buddy.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.hash.slice(1));
const renderer = new BuddyPokeRenderer($('#buddy-canvas'));

async function boot() {
  try {
    await renderer.load((msg) => { $('#loading-text').textContent = msg; });
    // An unreadable code falls back to the default buddy inside deserializeCompressed.
    await renderer.buddy1.deserializeCompressed(params.get('code') || DEFAULT_BUDDY);
    $('#loading').hidden = true;
    renderer.start();
    // The stored mood may be locked (its animation is missing); fall back to the first that works
    const moods = MOODS.list.filter((m) => renderer.moodAvailable(m));
    const mood = moods.find((m) => m.id === params.get('mood')) || moods.find((m) => m.id === 'm_hppy') || moods[0];
    if (mood) renderer.showMood(mood.id);
  } catch (e) {
    console.error(e);
    $('#loading-text').textContent = 'BuddyPoke could not start: ' + e.message;
  }
}

boot();
