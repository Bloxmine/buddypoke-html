// Small UI helpers: icon sprite positions, a single shared popover and
// toast notifications.

// buddypoke.render.Icons: 16x16 icons laid out 7 per row. `size` is the
// displayed icon size (the sheet is scaled to match).
export function iconStyle(i, size = 16) {
  const x = (i % 7) * size, y = Math.floor(i / 7) * size;
  return `background-position:-${x}px -${y}px`;
}

const pop = document.getElementById('popover');
let anchor = null;

export const popover = {
  open(anchorEl, content) {
    anchor = anchorEl;
    pop.innerHTML = '';
    pop.appendChild(content);
    pop.hidden = false;
    position();
    requestAnimationFrame(() => {
      const sel = pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button');
      if (sel) sel.focus({ preventScroll: false });
    });
  },
  close() {
    if (pop.hidden) return;
    pop.hidden = true;
    pop.innerHTML = '';
    if (anchor && document.body.contains(anchor)) anchor.focus({ preventScroll: true });
    anchor = null;
  },
  get isOpen() { return !pop.hidden; },
};

function position() {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.left;
  let top = r.bottom + 6;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - 8 - pr.width;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - 6 - pr.height);
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = top + 'px';
}

document.addEventListener('pointerdown', (e) => {
  if (!pop.hidden && !pop.contains(e.target) && (!anchor || !anchor.contains(e.target))) popover.close();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') popover.close(); });
window.addEventListener('resize', () => popover.close());
document.addEventListener('scroll', (e) => { if (!pop.contains(e.target)) popover.close(); }, true);

const toastEl = document.getElementById('toast');
let toastTimer = 0;
export function toast(msg, action = null, ms = 2600) {
  toastEl.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  toastEl.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', () => { toastEl.hidden = true; action.onClick(); });
    toastEl.appendChild(b);
  }
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, action ? Math.max(ms, 6000) : ms);
}
