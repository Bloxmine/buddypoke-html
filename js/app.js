// BuddyPoke HTML5 front end: wires the renderer to the page UI. The social
// side (friends, pokes you receive, gold) is simulated in the browser; see
// social.js. State is kept in localStorage; there is no server.

import { BuddyPokeRenderer } from './pokerenderer.js';
import { MOODS, POKES } from './data/moods.js';
import { setTextureScale } from './medialib.js';
import { CustomizePanel } from './ui/customize.js';
import { iconStyle, popover, toast } from './ui/widgets.js';
const pop = document.getElementById('popover');
import { Social, SHOP, GOLD_RULES } from './social.js';
import { PaperBuddies, pagesToPDF } from './paper.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ------------------------------------------------------------ storage
const store = {
  get(k, def) { try { const v = localStorage.getItem('bp.' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('bp.' + k, JSON.stringify(v)); return true; } catch { return false; } },
  clear() { try { Object.keys(localStorage).filter((k) => k.startsWith('bp.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } },
};

const settings = Object.assign({ name: 'Buddy', fps: 0, texScale: 2, bg: 'white' }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

// Category bit -> [label, icon index]. "All" uses the spiral icon.
const MOOD_CATS = [[0, 'All moods', 93], [2, 'Feelings', 84], [1, 'Activities', 72], [4, 'Moody', 77], [8, 'Sports', 99], [16, 'Dance', 14], [32, 'Music', 35], [64, 'Holiday', 55], [128, 'Special', 40]];
const POKE_CATS = [[0, 'All pokes', 93], [2, 'Love', 68], [1, 'Activities', 72], [4, 'Fight', 50], [8, 'Sports', 99], [16, 'Dance', 14], [32, 'Music', 35], [64, 'Holiday', 55], [128, 'Special', 40]];

// Background pattern layers that must be bought in the Gold shop.
const LOCKED_LAYERS = { bg2: 'bkg-stripes', bg3: 'bkg-icons', bg4: 'bkg-rainbow' };

// Premium moods/pokes: the July 2009 data marks them with cost (in coins)
// and pid; they were bought once with gold. Coins are scaled to our gold.
const GOLD_PER_COIN = 10;
const premiumId = (item) => (item.cost && item.free !== '1' ? 'p' + (item.pid || item.id) : null);
const premiumPrice = (item) => Number(item.cost) * GOLD_PER_COIN;
const isUnlocked = (item) => { const id = premiumId(item); return !id || social.owns(id); };

const LOCK_SVG = '<svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M3.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="#c9c9c9" stroke-width="1.6"/><rect x="1.5" y="7" width="11" height="8" rx="1.5" fill="#e4e4e4" stroke="#c9c9c9"/></svg>';

const fill = (tpl, a, b) => String(tpl || '').replace('%1', a).replace('%2', b).replace('%', a);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const moodDef = (id) => MOODS.list.find((m) => m.id === id);
const pokeDef = (id) => POKES.list.find((p) => p.id === id);
const nameB = (n) => `<b>${esc(n)}</b>`;

// ------------------------------------------------------------ setup
const canvas = $('#buddy-canvas');
const stage = $('#stage');
const renderer = new BuddyPokeRenderer(canvas);
setTextureScale(settings.texScale);
renderer.fps = settings.fps;
window.buddypoke = renderer; // handy for debugging from the console

for (const i of $$('.ico[data-icon]')) i.setAttribute('style', iconStyle(Number(i.dataset.icon)));

function sizeCanvas() {
  const r = stage.getBoundingClientRect();
  renderer.gl.resize(r.width, r.height);
}
new ResizeObserver(sizeCanvas).observe(stage);
sizeCanvas();
applyBackground();

let social = null;
let customizePanel = null;
let activeTab = 'mood';
const firstMood = () => (MOODS.list.find((m) => m.id === 'm_hppy') || MOODS.list[0]).id;
let myMood = store.get('myMood', { id: 'm_hppy', comment: '' });
let view = null;            // what the stage shows: {kind, ...}
let preview = null;         // selected (not yet saved) mood/poke in the lists
let selectedFriendId = store.get('selFriend', null);

const myCode = () => store.get('me', null);
const friend = () => social.friend(selectedFriendId) || social.friends[0] || null;
const nameOf = (id) => (id === 'me' ? settings.name : (social.friend(id) || { name: 'a former friend' }).name);
const codeOf = (id) => (id === 'me' ? myCode() : (social.friend(id) || {}).code || null);

// ------------------------------------------------------------ cast
// buddy1/buddy2 are re-dressed as needed (e.g. to replay a poke a friend
// sent you, where the friend is the one doing the poking).
const cast = { b1: undefined, b2: undefined };
async function setCast(code1, code2) {
  if (cast.b1 !== code1) { cast.b1 = code1; await renderer.buddy1.deserializeCompressed(code1); }
  if (cast.b2 !== code2) { cast.b2 = code2; await renderer.buddy2.deserializeCompressed(code2); }
}
const standardCast = () => setCast(myCode(), friend() ? friend().code : null);

// ------------------------------------------------------------ stage views
async function showView(v) {
  view = v;
  if (renderer.mode === 'customize') leaveCustomizeStage();
  if (v.kind === 'mood') {
    await setCast(myCode(), cast.b2); // the friend's buddy is only needed for pokes
    renderer.showMood(v.id);
    setStatus(fill(moodDef(v.id).desc, nameB(settings.name)), v.comment);
  } else if (v.kind === 'poke') {
    await standardCast();
    renderer.showPoke(v.id);
    setStatus(fill(pokeDef(v.id).hist, nameB(settings.name), nameB(friend() ? friend().name : 'your friend')), v.comment);
  } else if (v.kind === 'friendMood') {
    const f = social.friend(v.friendId);
    if (!f) return showMyMood();
    await setCast(f.code, cast.b2);
    renderer.showMood(f.mood);
    setStatus(fill(moodDef(f.mood).desc, nameB(f.name)));
  } else if (v.kind === 'event') {
    const e = v.event;
    if (e.type === 'mood') {
      await setCast(codeOf(e.fr), cast.b2);
      renderer.showMood(e.a);
      setStatus(fill(moodDef(e.a).hist, nameB(nameOf(e.fr))), e.m);
    } else {
      await setCast(codeOf(e.fr), codeOf(e.to));
      renderer.showPoke(e.a);
      setStatus(fill(pokeDef(e.a).hist, nameB(nameOf(e.fr)), nameB(nameOf(e.to))), e.m);
    }
  }
  markCurrent();
}

const showMyMood = () => showView({ kind: 'mood', id: myMood.id, comment: myMood.comment });

function setStatus(html, comment) {
  $('#status-line').innerHTML = (html || '&nbsp;') + (comment ? `: <q>${esc(comment)}</q>` : '');
}

// ------------------------------------------------------------ tabs
function showTab(name) {
  activeTab = name;
  for (const b of $$('.bp-tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of $$('.panel')) p.hidden = p.dataset.panel !== name;
  popover.close();
  requestAnimationFrame(wakeFaces);
  if (name === 'appearance') { enterCustomize(); return; }
  if (renderer.mode === 'customize') leaveCustomizeStage();
  if (name === 'home') { social.markRead(); renderProfile(); }
  if (name === 'gold') renderGold();
  if (name === 'create') renderComic();
  if (name === 'mood' || name === 'home' || name === 'gold' || name === 'pictures' || name === 'help') {
    if (!view || view.kind !== 'mood' || view.id !== myMood.id) showMyMood();
  }
  if (name === 'friends' && preview && preview.type === 'poke') showView({ kind: 'poke', id: preview.id });
}
for (const b of $$('.bp-tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));

// ------------------------------------------------------------ mood / poke lists
function buildCatTabs(root, cats, list, onChange) {
  const present = cats.filter(([bit]) => bit === 0 || list.some((x) => (Number(x.cat) & bit) !== 0));
  let active = 0;
  root.innerHTML = '';
  for (const [bit, label, icon] of present) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-selected', String(bit === active));
    b.innerHTML = `<i class="ico" style="${iconStyle(icon, 32)}"></i>`;
    b.addEventListener('click', () => {
      active = bit;
      for (const c of root.children) c.setAttribute('aria-selected', String(c === b));
      onChange();
    });
    root.appendChild(b);
  }
  return () => active;
}

function buildList(ul, list, available, onPick, cat, type) {
  ul.innerHTML = '';
  for (const item of list) {
    if (cat && (Number(item.cat) & cat) === 0) continue;
    const ok = available(item);
    const li = document.createElement('li');
    li.dataset.id = item.id;
    li.className = ok ? '' : 'locked';
    li.title = ok ? item.desc.replace('%', type === 'poke' ? (friend() ? friend().name : 'your friend') : settings.name) : 'Locked: this animation was streamed from MySpace servers that no longer exist.';
    const needsGold = ok && !isUnlocked(item);
    const price = needsGold ? `<span class="price"><i class="coin sm"></i>${premiumPrice(item)}</span>` : '';
    li.innerHTML = `<span class="lock">${ok ? '' : LOCK_SVG}</span><span class="radio"></span><i class="ico" style="${iconStyle(Number(item.icon) || 0)}"></i><span class="name">${esc(item.name)}</span>${price}`;
    if (needsGold) li.title = `Unlock “${item.name}” for ${premiumPrice(item)} gold. Once unlocked, you may use it as many times as you like.`;
    if (ok) {
      li.tabIndex = 0;
      li.setAttribute('role', 'radio');
      const pick = () => (isUnlocked(item) ? onPick(item.id) : offerUnlock(item, () => onPick(item.id)));
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    ul.appendChild(li);
  }
  markCurrent();
}

let moodCat = () => 0;
let pokeCat = () => 0;
const refreshMoodList = () => buildList($('#mood-list'), MOODS.list, (m) => renderer.moodAvailable(m), previewMood, moodCat(), 'mood');
const refreshPokeList = () => buildList($('#poke-list'), POKES.list, (p) => renderer.pokeAvailable(p), previewPoke, pokeCat(), 'poke');

// The original BuyFeatureWindow: confirm, pay, then use it forever.
function offerUnlock(item, then) {
  const price = premiumPrice(item);
  if (social.gold < price) {
    toast(`“${item.name}” costs ${price} gold. You need ${price - social.gold} more.`, { label: 'Get gold', onClick: () => showTab('gold') });
    return;
  }
  if (!confirm(`Unlock “${item.name}” for ${price} gold?\nOnce unlocked, you may use it as many times as you like.`)) return;
  social.unlock(premiumId(item), price, item.name);
  refreshMoodList();
  refreshPokeList();
  then();
}

function markCurrent() {
  const moodSel = preview && preview.type === 'mood' ? preview.id : myMood.id;
  for (const li of $$('#mood-list li')) li.classList.toggle('current', li.dataset.id === moodSel);
  const pokeSel = preview && preview.type === 'poke' ? preview.id : null;
  for (const li of $$('#poke-list li')) li.classList.toggle('current', li.dataset.id === pokeSel);
}

function previewMood(id) {
  preview = { type: 'mood', id };
  showView({ kind: 'mood', id, comment: $('#mood-comment').value.trim() });
  $('#mood-hint').textContent = id === myMood.id ? 'This is your current mood.' : 'Preview. Press Save to keep it.';
}

function previewPoke(id) {
  preview = { type: 'poke', id };
  showView({ kind: 'poke', id, comment: $('#poke-comment').value.trim() });
}

function saveMood() {
  const id = preview && preview.type === 'mood' ? preview.id : myMood.id;
  const comment = $('#mood-comment').value.trim();
  myMood = { id, comment };
  store.set('myMood', myMood);
  social.setMood(id, comment);
  preview = null;
  $('#mood-comment').value = ''; updateCounter($('#mood-comment'));
  $('#mood-hint').textContent = 'Mood saved.';
  showMyMood();
  toast('Mood saved: ' + moodDef(id).name);
}

function sendPoke() {
  const f = friend();
  if (!f) return toast('Add a friend first');
  if (!preview || preview.type !== 'poke') return toast('Pick a poke from the list first');
  const comment = $('#poke-comment').value.trim();
  social.poke(f.id, preview.id, comment, $('#poke-private').checked);
  showView({ kind: 'poke', id: preview.id, comment });
  toast(`You poked ${f.name}: ${pokeDef(preview.id).name}`);
  $('#poke-comment').value = ''; updateCounter($('#poke-comment'));
}

function updateCounter(input) { $(`.count[data-for="${input.id}"]`).textContent = input.value.length + '/100'; }

function initLists() {
  moodCat = buildCatTabs($('#mood-cats'), MOOD_CATS, MOODS.list, refreshMoodList);
  pokeCat = buildCatTabs($('#poke-cats'), POKE_CATS, POKES.list, refreshPokeList);
  refreshMoodList();
  refreshPokeList();
  for (const input of $$('.comment input')) input.addEventListener('input', () => updateCounter(input));
  $('#mood-comment').addEventListener('input', () => { if (view && view.kind === 'mood') setStatus(fill(moodDef(view.id).desc, nameB(settings.name)), $('#mood-comment').value.trim()); });
  $('#mood-save').addEventListener('click', saveMood);
  $('#poke-send').addEventListener('click', sendPoke);
}

// ------------------------------------------------------------ faces
// Portraits need a fully dressed buddy (all textures built), which is the
// most expensive thing the app does. Render them one at a time, in idle
// time, only for images that are actually on screen, and cache the result.
const faceCache = new Map(Object.entries(store.get('faces', {})));
const faceWaiting = new Map(); // img -> code
let facePumping = false;
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 60));

function setFace(img, code) {
  if (!img || !code) return;
  if (faceCache.has(code)) { img.src = faceCache.get(code); return; }
  faceWaiting.set(img, code);
  if (!facePumping) { facePumping = true; idle(pumpFaces); }
}

async function pumpFaces() {
  // Pick an image that is visible; drop images that left the page.
  let job = null;
  for (const [img, code] of faceWaiting) {
    if (!img.isConnected) { faceWaiting.delete(img); continue; }
    if (faceCache.has(code)) { img.src = faceCache.get(code); faceWaiting.delete(img); continue; }
    if (img.offsetParent !== null) { job = [img, code]; break; }
  }
  if (!job) { facePumping = false; return; } // the rest waits until shown
  const [img, code] = job;
  faceWaiting.delete(img);
  await renderer.portraitBuddy.deserializeCompressed(code);
  const c = renderer.portrait(renderer.portraitBuddy, 64, 64);
  const url = c ? c.toDataURL('image/png') : '';
  faceCache.set(code, url);
  store.set('faces', Object.fromEntries([...faceCache.entries()].slice(-120)));
  if (url) img.src = url;
  idle(pumpFaces);
}

// Re-queue portraits that were hidden when they were first requested.
function wakeFaces() { if (faceWaiting.size && !facePumping) { facePumping = true; idle(pumpFaces); } }

// ------------------------------------------------------------ friends tab
function renderFriends() {
  const strip = $('#friend-strip');
  strip.innerHTML = '';
  const f = friend();
  if (f && f.id !== selectedFriendId) { selectedFriendId = f.id; store.set('selFriend', f.id); }
  for (const fr of social.friends) {
    const b = document.createElement('button');
    b.className = 'friend-chip';
    b.setAttribute('aria-selected', String(fr.id === selectedFriendId));
    b.innerHTML = `<img alt=""><span>${esc(fr.name)}</span>`;
    setFace(b.querySelector('img'), fr.code);
    b.addEventListener('click', () => selectFriend(fr.id));
    strip.appendChild(b);
  }
  const add = document.createElement('button');
  add.className = 'friend-chip';
  add.innerHTML = '<span class="add">+</span><span>Add friend</span>';
  add.addEventListener('click', () => addFriendMenu(add));
  strip.appendChild(add);

  $('#friend-card').hidden = !f;
  if (f) {
    $('#friend-name-label').textContent = f.name;
    const m = moodDef(f.mood);
    $('#friend-mood').innerHTML = m ? `<i class="ico" style="${iconStyle(Number(m.icon) || 0)}"></i> ${esc(fill(m.desc, f.name))}` : '';
    setFace($('#friend-face'), f.code);
  }
  $('#poke-target').textContent = f ? f.name : 'your friend';
  $('#poke-send').textContent = f ? `Poke ${f.name}!` : 'Poke!';
}

async function selectFriend(id) {
  selectedFriendId = id;
  store.set('selFriend', id);
  renderFriends();
  refreshPokeList();
  if (view && view.kind === 'poke') showView(view);
}

function addFriendMenu(anchor) {
  const wrap = document.createElement('div');
  wrap.className = 'menu';
  wrap.innerHTML = `<h3>Add a friend</h3><input type="text" placeholder="Name" maxlength="24"><button data-a="random">Add with a random look</button><button data-a="code">Add from an appearance code…</button>`;
  const input = wrap.querySelector('input');
  wrap.querySelector('[data-a=random]').addEventListener('click', async () => {
    popover.close();
    const f = await social.addFriend(input.value.trim() || null);
    selectFriend(f.id);
    toast(`${f.name} is now your friend`);
  });
  wrap.querySelector('[data-a=code]').addEventListener('click', async () => {
    const code = prompt('Paste a BuddyPoke appearance code:');
    popover.close();
    if (!code || code.trim().length < 10) return;
    try {
      const { decodeBuddyString } = await import('./buddy.js');
      JSON.parse(await decodeBuddyString(code.trim()));
    } catch { return toast('That code could not be read'); }
    const f = await social.addFriend(input.value.trim() || null, code.trim());
    selectFriend(f.id);
  });
  popover.open(anchor, wrap);
  setTimeout(() => input.focus(), 30);
}

function friendMoreMenu(anchor) {
  const f = friend();
  if (!f) return;
  const wrap = document.createElement('div');
  wrap.className = 'menu';
  wrap.innerHTML = `<h3>${esc(f.name)}</h3>
    <button data-a="rename">Rename…</button>
    <button data-a="random">Randomize look</button>
    <button data-a="gift">Gift 10 gold</button>
    <button data-a="remove">Remove friend</button>`;
  wrap.querySelector('[data-a=rename]').addEventListener('click', () => {
    popover.close();
    const n = prompt('New name for ' + f.name + ':', f.name);
    if (n && n.trim()) social.updateFriend(f.id, { name: n.trim().slice(0, 24) });
  });
  wrap.querySelector('[data-a=random]').addEventListener('click', async () => {
    popover.close();
    social.updateFriend(f.id, { code: await randomCode() });
    if (view && (view.kind === 'poke' || view.kind === 'friendMood')) showView(view);
  });
  wrap.querySelector('[data-a=gift]').addEventListener('click', () => {
    popover.close();
    if (social.giftGold(f.id, 10)) toast(`You sent ${f.name} 10 gold`);
    else toast('Not enough gold');
  });
  wrap.querySelector('[data-a=remove]').addEventListener('click', () => {
    popover.close();
    if (!confirm(`Remove ${f.name} from your friends?`)) return;
    social.removeFriend(f.id);
    selectedFriendId = null;
    renderFriends();
  });
  popover.open(anchor, wrap);
}

function initFriends() {
  $('#friend-view').addEventListener('click', () => { const f = friend(); if (f) showView({ kind: 'friendMood', friendId: f.id }); });
  $('#friend-edit').addEventListener('click', () => { setAppearanceTarget('friend'); showTab('appearance'); });
  $('#friend-more').addEventListener('click', (e) => friendMoreMenu(e.currentTarget));
  renderFriends();
}

// ------------------------------------------------------------ profile / history (BuddyPoke tab)
let historyFilter = 'all';
function renderProfile() {
  $('#my-name').textContent = settings.name;
  const m = moodDef(myMood.id);
  $('#my-mood').innerHTML = m ? `<i class="ico" style="${iconStyle(Number(m.icon) || 0)}"></i> ${esc(fill(m.desc, settings.name))}` : '';
  $('#stat-sent').textContent = social.data.pokeCnt;
  $('#stat-rec').textContent = social.data.recCnt;
  $('#stat-gold').textContent = social.gold;
  setFace($('#my-face'), myCode());
  renderHistory();
}

function renderHistory() {
  const ul = $('#history');
  ul.innerHTML = '';
  const events = social.data.history.filter((e) => {
    if (historyFilter === 'received') return e.type === 'poke' && e.to === 'me';
    if (historyFilter === 'sent') return e.type === 'poke' && e.fr === 'me';
    if (historyFilter === 'moods') return e.type === 'mood';
    return true;
  });
  $('#history-empty').hidden = events.length > 0;
  const unread = social.data.unread;
  let incomingSeen = 0;
  for (const e of events) {
    const def = e.type === 'mood' ? moodDef(e.a) : pokeDef(e.a);
    if (!def) continue;
    const li = document.createElement('li');
    const who = (id) => `<span class="who">${esc(id === 'me' ? 'You' : nameOf(id))}</span>`;
    let text;
    if (e.type === 'mood') text = e.fr === 'me' ? `${who('me')} felt ${esc(def.name)}` : fill(def.hist, who(e.fr));
    else text = `${who(e.fr)} → ${who(e.to)}: ${esc(def.name)}`;
    if (e.m) text += ` <q>${esc(e.m)}</q>`;
    if (e.p) text += ' <span class="priv">(private)</span>';
    const received = e.type === 'poke' && e.to === 'me';
    if (received && incomingSeen++ < unread) li.classList.add('unread');
    li.innerHTML = `<i class="ico" style="${iconStyle(Number(def.icon) || 0)}"></i><span class="txt">${text}</span><span class="actions">${received && social.friend(e.fr) ? '<button class="link" data-a="back">poke back</button>' : ''}<time>${timeAgo(e.t)}</time><button class="del" data-a="del" aria-label="Delete">×</button></span>`;
    li.title = 'Play';
    li.addEventListener('click', (ev) => {
      const a = ev.target.dataset.a;
      if (a === 'del') { social.removeEvent(e.id); return; }
      if (a === 'back') {
        selectFriend(e.fr);
        showTab('friends');
        previewPoke(e.a);
        $('#poke-comment').focus();
        return;
      }
      showView({ kind: 'event', event: e });
    });
    ul.appendChild(li);
  }
}

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString();
}

function initProfile() {
  for (const b of $$('#history-filter button')) {
    b.addEventListener('click', () => {
      historyFilter = b.dataset.filter;
      for (const c of $$('#history-filter button')) c.setAttribute('aria-selected', String(c === b));
      renderHistory();
    });
  }
  $('#history-clear').addEventListener('click', () => { if (confirm('Clear your event history?')) social.clearHistory(); });
}

function updateUnread() {
  const n = social.data.unread;
  const el = $('#unread');
  el.hidden = n === 0;
  el.textContent = n > 9 ? '9+' : String(n);
}

// ------------------------------------------------------------ appearance
let appearanceTarget = 'me';
function setAppearanceTarget(who) {
  appearanceTarget = who;
  for (const b of $$('.who-tabs button')) b.setAttribute('aria-checked', String(b.dataset.target === who));
  const f = friend();
  $('.who-tabs [data-target=friend]').textContent = f ? f.name : 'My friend';
  if (renderer.mode === 'customize') enterCustomize();
}
for (const b of $$('.who-tabs button')) b.addEventListener('click', () => setAppearanceTarget(b.dataset.target));

const targetBuddy = () => (appearanceTarget === 'friend' ? renderer.buddy2 : renderer.buddy1);

async function enterCustomize() {
  if (!customizePanel) return;
  if (appearanceTarget === 'friend' && !friend()) appearanceTarget = 'me';
  if (appearanceTarget === 'friend') await standardCast(); else await setCast(myCode(), cast.b2);
  renderer.customize(targetBuddy());
  customizePanel.setBuddy(targetBuddy());
  stage.classList.add('examine');
  $('#stage-hint').hidden = false;
  setStatus(`Customizing ${nameB(appearanceTarget === 'friend' ? friend().name : settings.name)}`);
  clearTimeout(enterCustomize.t);
  enterCustomize.t = setTimeout(() => { $('#stage-hint').hidden = true; }, 3500);
}

function leaveCustomizeStage() {
  view = null; // force the next view to be re-applied (and the status line updated)
  stage.classList.remove('examine');
  $('#stage-hint').hidden = true;
  renderer.endCustomize();
  renderer.mode = 'mood';
}

$('#app-done').addEventListener('click', () => showTab('mood'));

async function saveAppearance() {
  const me = await renderer.buddy1.serializeCompressed();
  store.set('me', me);
  cast.b1 = me;
  const f = friend();
  if (f && appearanceTarget === 'friend') {
    const fc = await renderer.buddy2.serializeCompressed();
    cast.b2 = fc;
    social.updateFriend(f.id, { code: fc });
  }
  $('#set-code').value = me;
}

// Preset buddies from the Customization window (PresetsWindow).
let presets = null;
$('#app-presets').addEventListener('click', async (e) => {
  const anchor = e.currentTarget;
  if (!presets) presets = await fetch('assets/presets.json').then((r) => r.json()).catch(() => []);
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h3>Choose a preset</h3>';
  const grid = document.createElement('div');
  grid.className = 'preset-grid';
  for (const p of presets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<img alt=""><span>${esc(p.name)}</span>`;
    b.addEventListener('click', async () => {
      popover.close();
      await targetBuddy().deserializeCompressed(p.code);
      customizePanel.refresh();
      saveAppearance();
      toast('Preset applied: ' + p.name);
    });
    grid.appendChild(b);
  }
  wrap.appendChild(grid);
  popover.open(anchor, wrap);
  // Portraits render one at a time in idle time, as they scroll into view.
  [...grid.children].forEach((b, i) => setFace(b.querySelector('img'), presets[i].code));
  pop.addEventListener('scroll', wakeFaces, { passive: true });
});

$('#app-random').addEventListener('click', async () => {
  await targetBuddy().deserializeCompressed(await randomCode());
  customizePanel.refresh();
  saveAppearance();
});
$('#app-reset').addEventListener('click', async () => {
  await targetBuddy().resetToDefault();
  customizePanel.refresh();
  saveAppearance();
});

// Random appearance: pick random values for every customization id.
async function randomCode() {
  const { CUSTOMIZATION_OPTIONS } = await import('./data/options.js');
  const b = renderer.buddy1;
  const ser = {};
  for (const op of CUSTOMIZATION_OPTIONS) {
    if (op.name.startsWith('Background')) continue;
    for (const sub of op.items) {
      if (sub.type === 'color') {
        const tex = b.findTexture(sub.path);
        const pal = tex && renderer.matLib.getColorTintOption(tex.getAttribute('color'));
        if (pal) ser[sub.id] = Math.floor(Math.random() * pal.length);
        // Keep skin natural most of the time (the first 16 skin swatches).
        if (sub.id === 'hdc') ser.hdc = Math.random() < 0.9 ? Math.floor(Math.random() * 16) : ser.hdc;
      } else if (sub.type === 'texture') {
        const layer = b.findLayer(sub.path);
        if (layer) {
          const n = layer.getElementsByTagName('texture').length;
          // Mostly keep optional overlays (patterns, masks, beards…) off.
          ser[sub.id] = /Pattern|Mask|Beard|Mustache|5OClock|Glas|Spot|EyeShadow|Belt|Glve|Mouth/.test(sub.path) && Math.random() < 0.75 ? 0 : Math.floor(Math.random() * n);
        }
      } else if (sub.type === 'itemGroup') {
        const [cat, grp] = sub.path.split(';');
        const n = b.findGroupItems(cat, grp).length;
        ser[sub.id] = grp === 'Ears' ? (Math.random() < 0.8 ? 0 : Math.floor(Math.random() * n)) : Math.floor(Math.random() * n);
      }
    }
  }
  if (ser.hdc !== undefined) ser.bdc = ser.hdc;
  const { encodeBuddyString } = await import('./buddy.js');
  return encodeBuddyString(JSON.stringify(ser));
}

// ------------------------------------------------------------ gold
function renderGold() {
  $('#gold-amount').textContent = social.gold;
  const daily = $('#gold-daily');
  daily.disabled = !social.canClaimDaily();
  daily.textContent = social.canClaimDaily() ? `Claim daily bonus (+${GOLD_RULES.daily})` : 'Daily bonus claimed';
  const shop = $('#shop');
  shop.innerHTML = '';
  for (const item of SHOP) {
    const li = document.createElement('li');
    const owned = social.owns(item.id);
    li.innerHTML = `<i class="ico" style="${iconStyle(item.icon)}"></i><span class="txt">${esc(item.name)}<small>${esc(item.desc)}</small></span>` +
      (owned ? '<span class="owned">Owned</span>' : `<span class="price"><i class="coin sm"></i>${item.price}</span><button class="bp-btn">Buy</button>`);
    const btn = li.querySelector('button');
    if (btn) {
      btn.disabled = social.gold < item.price;
      btn.addEventListener('click', () => {
        if (social.buy(item.id)) toast(`${item.name} unlocked! Find it under Appearance → Background.`);
      });
    }
    shop.appendChild(li);
  }
  const prem = $('#premium');
  prem.innerHTML = '';
  const items = [...MOODS.list.map((m) => ['mood', m]), ...POKES.list.map((p) => ['poke', p])]
    .filter(([t, it]) => premiumId(it) && (t === 'mood' ? renderer.moodAvailable(it) : renderer.pokeAvailable(it)));
  for (const [type, it] of items) {
    const li = document.createElement('li');
    const owned = social.owns(premiumId(it));
    li.innerHTML = `<i class="ico" style="${iconStyle(Number(it.icon) || 0)}"></i><span class="txt">${esc(it.name)}<small>${type === 'mood' ? 'Mood' : 'Poke'}</small></span>` +
      (owned ? '<span class="owned">Unlocked</span>' : `<span class="price"><i class="coin sm"></i>${premiumPrice(it)}</span><button class="bp-btn">Unlock</button>`);
    const btn = li.querySelector('button');
    if (btn) {
      btn.disabled = social.gold < premiumPrice(it);
      btn.addEventListener('click', () => offerUnlock(it, () => toast(`${it.name} unlocked!`)));
    }
    prem.appendChild(li);
  }
  {
    const li = document.createElement('li');
    const owned = social.owns('paperbuddies');
    li.innerHTML = `<i class="ico" style="${iconStyle(71)}"></i><span class="txt">3D Paper Buddies<small>Print, cut and fold your buddy (Create tab)</small></span>` +
      (owned ? '<span class="owned">Unlocked</span>' : `<span class="price"><i class="coin sm"></i>${PAPER_PRICE}</span><button class="bp-btn">Unlock</button>`);
    const btn = li.querySelector('button');
    if (btn) { btn.disabled = social.gold < PAPER_PRICE; btn.addEventListener('click', () => { if (confirm(`Unlock 3D Paper Buddies for ${PAPER_PRICE} gold?`)) social.unlock('paperbuddies', PAPER_PRICE, '3D Paper Buddies'); }); }
    prem.appendChild(li);
  }
  $('#premium-title').hidden = false;
  $('#earn').innerHTML = [
    ['Daily bonus', `+${GOLD_RULES.daily}`],
    ['Poke a friend', `+${GOLD_RULES.pokeSent} (${GOLD_RULES.pokeSentCap}× a day)`],
    ['Save a new mood', `+${GOLD_RULES.mood} (${GOLD_RULES.moodCap}× a day)`],
    ['Get poked', `+${GOLD_RULES.pokeReceived}`],
  ].map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join('');
  $('#ledger').innerHTML = social.data.ledger.slice(0, 20).map((l) =>
    `<li><span>${esc(l.why)} <time>${timeAgo(l.t)}</time></span><span class="${l.amount >= 0 ? 'plus' : 'minus'}">${l.amount >= 0 ? '+' : ''}${l.amount}</span></li>`).join('');
}

function initGold() {
  $('#gold-daily').addEventListener('click', () => { if (social.claimDaily()) toast(`+${GOLD_RULES.daily} gold!`); });
}

// ------------------------------------------------------------ create (comic strips)
const comic = store.get('comic', [
  { action: 'mood:m_hppy', zoom: 'long', frac: 0.3, caption: 'Hi there!' },
  { action: 'poke:bhug', zoom: 'medium', frac: 0.55, caption: 'Come here, you!' },
  { action: 'mood:m_bshf', zoom: 'close', frac: 0.5, caption: 'Aww…' },
]);

function actionOptions(selected) {
  const mood = MOODS.list.filter((m) => renderer.moodAvailable(m)).map((m) => `<option value="mood:${m.id}"${selected === 'mood:' + m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  const poke = POKES.list.filter((p) => renderer.pokeAvailable(p)).map((p) => `<option value="poke:${p.id}"${selected === 'poke:' + p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  return `<optgroup label="Moods">${mood}</optgroup><optgroup label="Pokes (with your friend)">${poke}</optgroup>`;
}

function buildComicEditor() {
  const box = $('#comic-panels');
  box.innerHTML = '';
  comic.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'comic-panel';
    row.innerHTML = `<span class="num">${i + 1}</span>
      <select data-k="action" aria-label="Panel ${i + 1} animation">${actionOptions(p.action)}</select>
      <div class="line"><select data-k="zoom" aria-label="Camera"><option value="long">Long shot</option><option value="medium">Medium shot</option><option value="close">Close-up</option></select>
        <input type="range" data-k="frac" min="0" max="1" step="0.01" value="${p.frac}" aria-label="Moment in the animation"></div>
      <input type="text" data-k="caption" maxlength="60" placeholder="Speech bubble (optional)" value="${esc(p.caption || '')}">`;
    row.querySelector('[data-k=zoom]').value = p.zoom;
    for (const el of row.querySelectorAll('[data-k]')) {
      el.addEventListener('change', () => {
        p[el.dataset.k] = el.dataset.k === 'frac' ? Number(el.value) : el.value;
        store.set('comic', comic);
        renderComic();
      });
    }
    box.appendChild(row);
  });
}

let comicBusy = false;
async function renderComic() {
  if (comicBusy) return;
  comicBusy = true;
  const out = $('#comic-preview');
  const ctx = out.getContext('2d');
  const W = out.width, H = out.height, pad = 10, pw = (W - pad * 4) / 3, ph = H - pad * 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const withFriend = $('#comic-friend').checked;
  const saved = view;
  if (withFriend && comic.some((p) => p.action.startsWith('poke:'))) await standardCast();
  else await setCast(myCode(), cast.b2);
  for (let i = 0; i < comic.length; i++) {
    const p = comic[i];
    const [type, id] = p.action.split(':');
    const x = pad + i * (pw + pad), y = pad;
    let action = { type, id };
    if (type === 'poke' && !withFriend) action = { type: 'mood', id: firstMood() };
    const still = renderer.renderStill(action, p.frac, p.zoom, Math.round(pw * 2), Math.round(ph * 2));
    if (still) ctx.drawImage(still, x, y, pw, ph);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#222';
    ctx.strokeRect(x, y, pw, ph);
    if (p.caption) drawBubble(ctx, p.caption, x + 10, y + 10, pw - 20);
  }
  comicBusy = false;
  // Restore whatever the stage was showing.
  if (saved) showView(saved); else showMyMood();
}

function drawBubble(ctx, text, x, y, maxW) {
  ctx.font = 'bold 26px "Comic Sans MS", "Comic Neue", "Chalkboard SE", sans-serif';
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW - 28 && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  const lh = 30;
  const bw = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 28);
  const bh = lines.length * lh + 16;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, 12);
  ctx.moveTo(x + 26, y + bh);
  ctx.lineTo(x + 34, y + bh + 14);
  ctx.lineTo(x + 44, y + bh);
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(x + 27, y + bh - 2, 16, 4);
  ctx.fillStyle = '#222';
  lines.forEach((l, i) => ctx.fillText(l, x + 14, y + 6 + lh * (i + 0.85)));
}

// 3D Paper Buddies (Create window). The original unlocked it for 180 coins.
const PAPER_PRICE = 180;
let paper = null;
let paperPages = null;

function updatePaperPrice() {
  const owned = social.owns('paperbuddies');
  $('#paper-price').innerHTML = owned ? 'Unlocked: create as many as you like.' : `Unlock for <i class="coin sm"></i>${PAPER_PRICE} gold. Pay once, create thousands!`;
  $('#paper-save').textContent = owned ? 'Save and print' : 'Unlock this feature';
}

async function previewPaper() {
  paper = paper || new PaperBuddies(renderer);
  paper.pose = Number(($('input[name=paper-pose]:checked') || {}).value || 0);
  const status = $('#paper-status');
  status.hidden = false;
  status.textContent = 'Loading paper buddy…';
  $('#paper-pages').innerHTML = '';
  await setCast(myCode(), cast.b2);
  const saved = view;
  paperPages = await paper.build(renderer.buddy1, (d, t) => { status.textContent = `Creating page ${d} of ${t}…`; });
  status.hidden = paperPages.length > 0;
  if (!paperPages.length) status.textContent = 'Nothing to print.';
  for (const pg of paperPages) {
    const f = document.createElement('figure');
    const img = new Image();
    img.src = pg.canvas.toDataURL('image/jpeg', 0.7);
    f.appendChild(img);
    const cap = document.createElement('figcaption');
    cap.textContent = pg.name.replace(/_/g, ' ');
    f.appendChild(cap);
    g(f);
  }
  function g(f) { $('#paper-pages').appendChild(f); }
  if (saved) showView(saved);
}

async function savePaper() {
  if (!social.owns('paperbuddies')) {
    if (social.gold < PAPER_PRICE) return toast(`3D Paper Buddies costs ${PAPER_PRICE} gold. You need ${PAPER_PRICE - social.gold} more.`, { label: 'Get gold', onClick: () => showTab('gold') });
    if (!confirm(`Unlock 3D Paper Buddies for ${PAPER_PRICE} gold?\nOnce unlocked, you may use this feature as many times as you like.`)) return;
    social.unlock('paperbuddies', PAPER_PRICE, '3D Paper Buddies');
    updatePaperPrice();
  }
  if (!paperPages) await previewPaper();
  if (!paperPages || !paperPages.length) return;
  toast('Creating PDF…');
  const pdf = await pagesToPDF(paperPages.map((p) => p.canvas));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(pdf);
  a.download = 'paperbuddy.pdf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast('Save your Paper Buddy, then print, cut and fold!');
}

function initCreate() {
  for (const b of $$('#create-tabs button')) {
    b.addEventListener('click', () => {
      for (const c of $$('#create-tabs button')) c.setAttribute('aria-selected', String(c === b));
      for (const p of $$('[data-create-panel]')) p.hidden = p.dataset.createPanel !== b.dataset.create;
      if (b.dataset.create === 'paper') updatePaperPrice();
    });
  }
  $('#paper-preview').addEventListener('click', previewPaper);
  $('#paper-save').addEventListener('click', savePaper);
  for (const r of $$('input[name=paper-pose]')) r.addEventListener('change', () => { if (paperPages) previewPaper(); });
  buildComicEditor();
  $('#comic-render').addEventListener('click', renderComic);
  $('#comic-friend').addEventListener('change', renderComic);
  $('#comic-save').addEventListener('click', () => {
    addPicture($('#comic-preview').toDataURL('image/png'), 'Comic');
    toast('Comic saved to Pictures', { label: 'View', onClick: () => showTab('pictures') });
  });
}

// ------------------------------------------------------------ pictures
let pictures = store.get('pictures', []);
function addPicture(url, kind) {
  pictures.unshift({ url, t: Date.now(), kind });
  // localStorage is small: drop the oldest pictures until it fits.
  while (pictures.length && !store.set('pictures', pictures)) pictures.pop();
  renderPictures();
}
function renderPictures() {
  const g = $('#gallery');
  g.innerHTML = '';
  pictures.forEach((s, i) => {
    const f = document.createElement('figure');
    f.innerHTML = `<img src="${s.url}" alt="${esc(s.kind || 'Picture')} ${i + 1}"><figcaption><span>${esc(s.kind || 'Picture')} · ${new Date(s.t).toLocaleDateString()}</span><span><a href="${s.url}" download="buddypoke-${s.t}.png">Save</a> <button class="del">Delete</button></span></figcaption>`;
    f.querySelector('.del').addEventListener('click', () => { pictures.splice(i, 1); store.set('pictures', pictures); renderPictures(); });
    g.appendChild(f);
  });
  $('#gallery-empty').hidden = pictures.length > 0;
}
function initPictures() {
  $('#snapshot').addEventListener('click', () => {
    // Downscale the stage to the original 2x panel size to keep storage small.
    const c = document.createElement('canvas');
    c.width = 692; c.height = 520;
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    addPicture(c.toDataURL('image/png'), 'Picture');
  });
  renderPictures();
}

// ------------------------------------------------------------ stage input
function initStage() {
  let dragging = false;
  const toPanelX = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * 346;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (renderer.mode !== 'customize') return;
    dragging = true;
    stage.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
    renderer.examineDown(toPanelX(e));
    $('#stage-hint').hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging) renderer.examineMove(toPanelX(e)); });
  const up = () => { dragging = false; stage.classList.remove('dragging'); renderer.examineUp(); };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}

// ------------------------------------------------------------ settings (?)
function applyBackground() {
  stage.classList.toggle('transparent', settings.bg === 'transparent');
  renderer.gl.background = settings.bg === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1];
  renderer.showBackgrounds = settings.bg !== 'transparent';
}

function initSettings() {
  const name = $('#set-name'), fname = $('#set-friend-name'), fps = $('#set-fps'), tex = $('#set-texscale'), bg = $('#set-bg'), code = $('#set-code');
  name.value = settings.name;
  if (fname) fname.closest('label').hidden = true; // friends are managed on the Friends tab now
  fps.value = String(settings.fps); tex.value = String(settings.texScale); bg.value = settings.bg;
  code.value = myCode() || '';
  name.addEventListener('change', () => {
    settings.name = name.value.trim() || 'Buddy';
    saveSettings();
    if (view) showView(view);
  });
  fps.addEventListener('change', () => { settings.fps = Number(fps.value); renderer.fps = settings.fps; saveSettings(); });
  tex.addEventListener('change', () => {
    settings.texScale = Number(tex.value); saveSettings();
    setTextureScale(settings.texScale);
    renderer.matLib.layerCache = null;
    renderer.matLib.maskCache = null;
    renderer.buddy1.refresh(); renderer.buddy2.refresh();
  });
  bg.addEventListener('change', () => { settings.bg = bg.value; saveSettings(); applyBackground(); });
  $('#code-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code.value); toast('Copied'); } catch { code.select(); }
  });
  const apply = async (target) => {
    const v = code.value.trim();
    if (v.length < 10) return toast('Paste an appearance code first');
    try {
      const { decodeBuddyString } = await import('./buddy.js');
      JSON.parse(await decodeBuddyString(v));
    } catch { return toast('That code could not be read'); }
    if (target === 'me') { store.set('me', v); cast.b1 = undefined; }
    else if (friend()) social.updateFriend(friend().id, { code: v });
    if (view) showView(view);
    toast('Appearance applied');
  };
  $('#code-apply').addEventListener('click', () => apply('me'));
  $('#code-apply-friend').addEventListener('click', () => apply('friend'));
  $('#reset-all').addEventListener('click', () => {
    if (!confirm('Reset your buddy, friends, history, gold and settings?')) return;
    store.clear();
    location.reload();
  });
}

// ------------------------------------------------------------ social events
function onSocial(type, payload) {
  if (type === 'incoming') {
    const f = social.friend(payload.fr);
    const p = pokeDef(payload.a);
    if (f && p) {
      toast(`${f.name} ${fill(p.hist, '', 'you').trim()}!`, { label: 'Watch', onClick: () => { social.markRead(); showView({ kind: 'event', event: payload }); } });
    }
  }
  if (type === 'friendMood' && activeTab === 'friends') renderFriends();
  if (type === 'friends') { renderFriends(); refreshPokeList(); }
  if (type === 'history' || type === 'incoming' || type === 'unread') {
    updateUnread();
    if (activeTab === 'home') { if (type === 'incoming') social.markRead(); renderProfile(); }
  }
  if (type === 'gold' || type === 'owned') {
    if (activeTab === 'gold') renderGold();
    if (activeTab === 'home') renderProfile();
    if (type === 'owned' && renderer.mode === 'customize') customizePanel.refresh();
  }
}

// ------------------------------------------------------------ start
async function boot() {
  try {
    await renderer.load((msg, p) => {
      $('#loading-text').textContent = msg;
      $('#loading-bar').style.width = Math.round(p * 100) + '%';
    });
    if (!myCode()) { await renderer.buddy1.deserializeCompressed(null); store.set('me', await renderer.buddy1.serializeCompressed()); }
    social = new Social({
      moods: MOODS, pokes: POKES, randomCode,
      isMoodAvailable: (m) => renderer.moodAvailable(m),
      isPokeAvailable: (p) => renderer.pokeAvailable(p),
    });
    await social.init();
    social.on(onSocial);
    window.bpSocial = social; // for debugging
    await setCast(myCode(), undefined); // the friend is dressed on first poke
    $('#loading').hidden = true;
    renderer.start();
    customizePanel = new CustomizePanel($('#options'), renderer, {
      onChange: saveAppearance,
      isLocked: (sub, i) => (i > 0 && LOCKED_LAYERS[sub.id] && !social.owns(LOCKED_LAYERS[sub.id]) ? LOCKED_LAYERS[sub.id] : null),
      onLocked: (itemId) => {
        const item = SHOP.find((s) => s.id === itemId);
        toast(`${item.name} costs ${item.price} gold`, { label: 'Go to shop', onClick: () => showTab('gold') });
      },
    });
    initLists();
    initFriends();
    initProfile();
    initGold();
    initCreate();
    initSettings();
    initStage();
    initPictures();
    updateUnread();
    if (!moodDef(myMood.id) || !renderer.moodAvailable(moodDef(myMood.id))) myMood = { id: firstMood(), comment: '' };
    showMyMood();
    social.start();
    if (social.data.unread) toast(`You have ${social.data.unread} new poke${social.data.unread > 1 ? 's' : ''}`, { label: 'Show', onClick: () => showTab('home') });
  } catch (e) {
    console.error(e);
    $('#loading-text').textContent = 'Could not start: ' + e.message;
    $('.spinner').hidden = true;
  }
}

boot();
