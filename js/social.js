// Simulated BuddyPoke social layer. The original stored this per user on
// MySpace / App Engine (bdData: {points, pokeCnt, recCnt, data.history[]}
// with events {fr, to, a, t, m, p}). Here everything lives in localStorage
// and a small simulation makes friends poke you, poke back and change moods.

const KEY = 'bp.social';

const NAMES = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Jamie', 'Robin', 'Avery', 'Quinn', 'Charlie', 'Skyler', 'Dakota', 'Emerson', 'Rowan'];
const COMMENTS = ['hey you!', 'miss you :)', 'haha', 'poke war!!', 'hi there', 'what’s up?', 'you’re the best', 'xD', 'lol', 'boo!', 'hugs', 'see you soon', 'ha, got you', '<3', 'long time no see'];

export const GOLD_RULES = {
  start: 100,
  daily: 20,
  pokeSent: 5,      // up to pokeSentCap per day
  pokeSentCap: 10,
  mood: 2,          // up to moodCap per day
  moodCap: 5,
  pokeReceived: 3,
};

export const SHOP = [
  { id: 'bkg-stripes', name: 'Background stripes', desc: 'Diagonal stripes, ribbons and plaid for your background.', price: 40, icon: 16 },
  { id: 'bkg-icons', name: 'Background icons', desc: 'Flowers, hearts, skulls and stars for your background.', price: 60, icon: 61 },
  { id: 'bkg-rainbow', name: 'Rainbows', desc: 'Two rainbow overlays for your background.', price: 80, icon: 72 },
];

const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Social {
  constructor({ moods, pokes, randomCode, isMoodAvailable, isPokeAvailable }) {
    this.moods = moods;
    this.pokes = pokes;
    this.randomCode = randomCode;
    this.isMoodAvailable = isMoodAvailable;
    this.isPokeAvailable = isPokeAvailable;
    this.listeners = new Set();
    this.timers = [];
    this.data = this.load();
  }

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && d.friends) return d;
    } catch { /* fresh start */ }
    return null;
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage full or unavailable */ }
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, payload) { for (const fn of this.listeners) fn(type, payload); }

  availableMoods() { return this.moods.list.filter((m) => this.isMoodAvailable(m)); }
  availablePokes() { return this.pokes.list.filter((p) => this.isPokeAvailable(p)); }

  // Creates the starting network on first run.
  async init() {
    if (!this.data) {
      this.data = {
        friends: [], history: [], gold: GOLD_RULES.start, pokeCnt: 0, recCnt: 0,
        ledger: [{ t: Date.now(), amount: GOLD_RULES.start, why: 'Welcome bonus' }],
        daily: {}, lastDaily: null, owned: [], lastVisit: Date.now(), unread: 0,
      };
      const names = [...NAMES].sort(() => Math.random() - 0.5).slice(0, 6);
      for (const name of names) await this.addFriend(name, null, false);
      // A couple of starting events so the profile is not empty.
      const now = Date.now();
      this.data.history.push(this.makeIncoming(this.data.friends[0], now - 1000 * 60 * 42));
      this.data.history.push(this.makeIncoming(this.data.friends[1], now - 1000 * 60 * 60 * 5));
      this.data.recCnt += 2;
      this.save();
    } else {
      this.catchUp();
    }
    this.data.lastVisit = Date.now();
    this.save();
  }

  // Events that "happened" while the page was closed.
  catchUp() {
    const away = Date.now() - (this.data.lastVisit || Date.now());
    const n = Math.min(4, Math.floor(away / (1000 * 60 * 20)));
    for (let i = 0; i < n; i++) {
      const f = pick(this.data.friends);
      if (!f) break;
      const t = this.data.lastVisit + Math.random() * away;
      if (Math.random() < 0.6) {
        this.data.history.unshift(this.makeIncoming(f, t));
        this.data.recCnt++;
        this.data.unread++;
      } else {
        const m = pick(this.availableMoods());
        if (m) { f.mood = m.id; f.moodTime = t; }
      }
    }
    this.data.history.sort((a, b) => b.t - a.t);
  }

  // ---------------------------------------------------------- friends
  get friends() { return this.data.friends; }
  friend(id) { return this.data.friends.find((f) => f.id === id) || null; }

  async addFriend(name, code = null, persist = true) {
    const m = pick(this.availableMoods());
    const f = { id: uid(), name: name || pick(NAMES), code: code || await this.randomCode(), mood: m ? m.id : null, moodTime: Date.now() - Math.random() * 1e7, since: Date.now() };
    this.data.friends.push(f);
    if (persist) { this.save(); this.emit('friends'); }
    return f;
  }

  removeFriend(id) {
    this.data.friends = this.data.friends.filter((f) => f.id !== id);
    this.save();
    this.emit('friends');
  }

  updateFriend(id, patch) {
    const f = this.friend(id);
    if (!f) return;
    Object.assign(f, patch);
    this.save();
    this.emit('friends');
  }

  // ---------------------------------------------------------- events
  makeIncoming(f, t = Date.now()) {
    const p = pick(this.availablePokes());
    return { id: uid(), type: 'poke', fr: f.id, to: 'me', a: p ? p.id : 'bhug', t, m: Math.random() < 0.45 ? pick(COMMENTS) : '', p: false };
  }

  addEvent(ev) {
    this.data.history.unshift({ id: uid(), t: Date.now(), ...ev });
    if (this.data.history.length > 100) this.data.history.length = 100;
    this.save();
    this.emit('history');
  }

  removeEvent(id) {
    this.data.history = this.data.history.filter((e) => e.id !== id);
    this.save();
    this.emit('history');
  }

  clearHistory() { this.data.history = []; this.save(); this.emit('history'); }

  markRead() { if (this.data.unread) { this.data.unread = 0; this.save(); this.emit('unread'); } }

  // You change your mood.
  setMood(moodId, comment) {
    this.addEvent({ type: 'mood', fr: 'me', to: 'me', a: moodId, m: comment || '', p: false });
    this.earn('mood', GOLD_RULES.mood, GOLD_RULES.moodCap, 'Changed your mood');
  }

  // You poke a friend. They may poke back a little later.
  poke(friendId, pokeId, comment, isPrivate) {
    const f = this.friend(friendId);
    if (!f) return;
    this.addEvent({ type: 'poke', fr: 'me', to: friendId, a: pokeId, m: comment || '', p: !!isPrivate });
    this.data.pokeCnt++;
    this.earn('pokeSent', GOLD_RULES.pokeSent, GOLD_RULES.pokeSentCap, 'Poked ' + f.name);
    if (Math.random() < 0.55) this.later(8000 + Math.random() * 30000, () => this.receivePoke(f, true));
  }

  receivePoke(f, isReply = false) {
    if (!this.friend(f.id)) return;
    const ev = this.makeIncoming(f);
    if (isReply && Math.random() < 0.5) ev.m = pick(['poke back!', 'right back at you', 'ha! my turn', 'hehe']);
    this.data.history.unshift(ev);
    this.data.recCnt++;
    this.data.unread++;
    this.addGold(GOLD_RULES.pokeReceived, f.name + ' poked you');
    this.save();
    this.emit('incoming', ev);
    this.emit('history');
  }

  // ---------------------------------------------------------- simulation
  start() {
    const tick = () => {
      const delay = 45000 + Math.random() * 90000;
      this.timers.push(setTimeout(() => {
        const f = pick(this.data.friends);
        if (f) {
          if (Math.random() < 0.55) this.receivePoke(f);
          else {
            const m = pick(this.availableMoods());
            if (m) {
              f.mood = m.id; f.moodTime = Date.now();
              this.save();
              this.emit('friendMood', f);
              this.emit('friends');
            }
          }
        }
        tick();
      }, delay));
    };
    tick();
    window.addEventListener('beforeunload', () => { this.data.lastVisit = Date.now(); this.save(); });
  }

  later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  // ---------------------------------------------------------- gold
  get gold() { return this.data.gold; }

  addGold(amount, why) {
    this.data.gold += amount;
    this.data.ledger.unshift({ t: Date.now(), amount, why });
    if (this.data.ledger.length > 40) this.data.ledger.length = 40;
    this.save();
    this.emit('gold');
  }

  earn(kind, amount, cap, why) {
    const d = today();
    if (!this.data.daily[d]) this.data.daily = { [d]: {} };
    const day = this.data.daily[d];
    day[kind] = (day[kind] || 0) + 1;
    if (day[kind] <= cap) this.addGold(amount, why);
  }

  canClaimDaily() { return this.data.lastDaily !== today(); }
  claimDaily() {
    if (!this.canClaimDaily()) return false;
    this.data.lastDaily = today();
    this.addGold(GOLD_RULES.daily, 'Daily bonus');
    return true;
  }

  owns(itemId) { return this.data.owned.includes(itemId); }
  buy(itemId) {
    const item = SHOP.find((s) => s.id === itemId);
    if (!item || this.owns(itemId) || this.data.gold < item.price) return false;
    this.data.owned.push(itemId);
    this.addGold(-item.price, 'Bought ' + item.name);
    this.emit('owned');
    return true;
  }

  // Premium moods/pokes (unlocked by id, price paid in gold).
  unlock(id, price, name) {
    if (this.owns(id) || this.data.gold < price) return false;
    this.data.owned.push(id);
    this.addGold(-price, 'Unlocked ' + name);
    this.emit('owned');
    return true;
  }

  giftGold(friendId, amount) {
    const f = this.friend(friendId);
    if (!f || amount <= 0 || this.data.gold < amount) return false;
    this.addGold(-amount, 'Gift to ' + f.name);
    if (Math.random() < 0.7) this.later(5000 + Math.random() * 10000, () => this.receivePoke(f, true));
    return true;
  }
}
