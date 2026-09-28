// Social layer for when BuddyPoke runs inside a host site (index.html?host=
// kuddes). Friends, pokes and the event history are real members, loaded
// from and sent to the host's API (same origin, the host's login cookie).
// Gold, the shop and premium unlocks work exactly as in the simulation
// (Social), but are saved to the member's account instead of localStorage.

import { Social, GOLD_RULES } from './social.js';

const API = '/api/buddypoke';
const POLL_MS = 20000;
const SAVE_DELAY_MS = 800;

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
  return data;
}

/** Loads the member, their friends and history. `withUser` adds someone to poke. */
export function fetchHostData(withUser) {
  return call('/me' + (withUser ? '?with=' + encodeURIComponent(withUser) : ''));
}

/** Saves the member's appearance code (and optionally mood) on the host. */
export function saveHostBuddy(patch) {
  return call('/me', { method: 'PATCH', body: patch });
}

export class HostSocial extends Social {
  constructor(opts, initial) {
    super(opts);
    this.initial = initial;
    this.saveTimer = null;
  }

  // Nothing is kept in localStorage in host mode.
  load() { return null; }

  async init() {
    const d = this.initial;
    const s = d.state;
    this.data = {
      friends: d.friends,
      history: d.history,
      pokeCnt: d.pokeCnt,
      recCnt: d.recCnt,
      unread: d.unread,
      gold: s ? s.gold : GOLD_RULES.start,
      ledger: s ? s.ledger : [{ t: Date.now(), amount: GOLD_RULES.start, why: 'Welcome bonus' }],
      daily: s ? s.daily : {},
      lastDaily: s ? s.lastDaily : null,
      owned: s ? s.owned : [],
      seenId: s ? s.seenId : 0,
    };
    if (!s) this.save();
  }

  // Gold and purchases go to the account, debounced (Social calls save() a lot).
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const { gold, ledger, daily, lastDaily, owned, seenId } = this.data;
      call('/me', { method: 'PATCH', body: { state: { gold, ledger: ledger.slice(0, 40), daily, lastDaily, owned, seenId } } })
        .catch((e) => console.warn('Could not save BuddyPoke gold', e));
    }, SAVE_DELAY_MS);
  }

  // No simulation: poll the host for pokes and mood changes of friends.
  start() {
    this.pollTimer = setInterval(() => this.refresh().catch(() => {}), POLL_MS);
  }

  async refresh() {
    const d = await fetchHostData(this.withUser);
    const known = new Set(this.data.history.map((e) => e.id));
    const incoming = d.history.filter((e) => !known.has(e.id) && e.type === 'poke' && e.to === 'me' && e.fr !== 'me');

    const moodChanged = d.friends.some((f) => {
      const old = this.friend(f.id);
      return !old || old.mood !== f.mood || old.code !== f.code;
    }) || d.friends.length !== this.data.friends.length;

    this.data.friends = d.friends;
    this.data.history = d.history;
    this.data.pokeCnt = d.pokeCnt;
    this.data.recCnt = d.recCnt;
    this.data.unread = d.unread;
    for (const ev of incoming.reverse()) {
      const f = this.friend(ev.fr);
      this.addGold(GOLD_RULES.pokeReceived, (f ? f.name : 'Someone') + ' poked you');
      this.emit('incoming', ev);
    }
    if (moodChanged) this.emit('friends');
    this.emit('history');
    this.emit('unread');
  }

  setMood(moodId, comment) {
    saveHostBuddy({ mood: moodId, comment: comment || '' })
      .then(() => this.refresh())
      .catch((e) => console.warn('Could not save mood', e));
    this.earn('mood', GOLD_RULES.mood, GOLD_RULES.moodCap, 'Changed your mood');
  }

  poke(friendId, pokeId, comment, isPrivate) {
    const f = this.friend(friendId);
    if (!f) return;
    call('/pokes', { method: 'POST', body: { to: friendId, a: pokeId, m: comment || '', p: !!isPrivate } })
      .then((ev) => {
        this.data.history.unshift(ev);
        this.data.pokeCnt++;
        this.emit('history');
      })
      .catch((e) => this.emit('error', e.message));
    this.earn('pokeSent', GOLD_RULES.pokeSent, GOLD_RULES.pokeSentCap, 'Poked ' + f.name);
  }

  removeEvent(id) {
    this.data.history = this.data.history.filter((e) => e.id !== id);
    this.emit('history');
    call('/events/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
  }

  clearHistory() {
    this.data.history = [];
    this.emit('history');
    call('/events', { method: 'DELETE' }).catch(() => {});
  }

  markRead() {
    if (!this.data.unread) return;
    const received = this.data.history.filter((e) => e.type === 'poke' && e.to === 'me').map((e) => Number(e.id));
    this.data.seenId = Math.max(this.data.seenId, ...received);
    this.data.unread = 0;
    this.save();
    this.emit('unread');
  }

  // Friends are the member's friends on the host; they're managed there.
  async addFriend() { return null; }
  updateFriend() {}
  removeFriend() {}
  receivePoke() {}
  giftGold() { return false; }
}
