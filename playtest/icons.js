// One flat icon set for the whole UI: 24×24, solid fills, the same dark outline everywhere.
// Replaces emoji, which render differently on every device and read as placeholder art.
const O = '#101827';                       // outline
const s = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" stroke="${O}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const ICONS = {
  coin: s(`<circle cx="12" cy="12" r="9" fill="#FFC94D"/><circle cx="12" cy="12" r="5.6" fill="#FFE08A" stroke-width="1.4"/><path d="M12 8.6v6.8" stroke-width="1.6"/>`),
  income: s(`<ellipse cx="9" cy="17" rx="6" ry="2.6" fill="#FFC94D"/><path d="M3 14.4v2.6M15 14.4v2.6" /><ellipse cx="9" cy="14.2" rx="6" ry="2.6" fill="#FFE08A"/><path d="M17 11V3.6M14 6.6l3-3 3 3" stroke="#55C879" stroke-width="2.6"/>`),
  speed: s(`<path d="M5 6h6l1 6 6 2.2c1.4.5 2 1.4 2 2.8v1H4.6L5 6z" fill="#F16E60"/><path d="M4.6 18h15.4v2H4.4z" fill="#FFF8E6"/><path d="M8 9h3M8.4 12h3.4" stroke-width="1.4"/>`),
  shop: s(`<path d="M4 10h16v10H4z" fill="#FFF8E6"/><path d="M3 5h18l-1 5H4z" fill="#F16E60"/><path d="M7.5 5l-.8 5M12 5v5M16.5 5l.8 5" stroke-width="1.4"/><path d="M9 20v-5h6v5" fill="#6FA8FF"/>`),
  pets: s(`<ellipse cx="12" cy="16" rx="5" ry="4.2" fill="#FFB36B"/><circle cx="5.6" cy="10.6" r="2.2" fill="#FFB36B"/><circle cx="18.4" cy="10.6" r="2.2" fill="#FFB36B"/><circle cx="9" cy="6.4" r="2.2" fill="#FFB36B"/><circle cx="15" cy="6.4" r="2.2" fill="#FFB36B"/>`),
  index: s(`<path d="M4 5.5c3-1.4 5.6-1.2 8 .5v14c-2.4-1.7-5-1.9-8-.5z" fill="#6FA8FF"/><path d="M20 5.5c-3-1.4-5.6-1.2-8 .5v14c2.4-1.7 5-1.9 8-.5z" fill="#9CC4FF"/>`),
  gift: s(`<path d="M4 10h16v10H4z" fill="#F16E60"/><path d="M3 7h18v3H3z" fill="#FF9486"/><path d="M12 7v13" stroke="${O}"/><path d="M12 7c-1-3-5-4-5-1.4C7 7 9.6 7 12 7c2.4 0 5 0 5-1.4C17 3 13 4 12 7z" fill="#FFC94D"/>`),
  rebirth: s(`<path d="M19 12a7 7 0 1 1-2.1-5" fill="none" stroke="#B48CFF" stroke-width="3.4"/><path d="M14 3.6l4 1.6-1.4 4" fill="none" stroke="#B48CFF" stroke-width="3"/>`),
  gear: s(`<path d="M10.2 2.8h3.6l.5 2.6 1.9.8 2.2-1.5 2.5 2.5-1.5 2.2.8 1.9 2.6.5v3.6l-2.6.5-.8 1.9 1.5 2.2-2.5 2.5-2.2-1.5-1.9.8-.5 2.6h-3.6l-.5-2.6-1.9-.8-2.2 1.5-2.5-2.5 1.5-2.2-.8-1.9-2.6-.5v-3.6l2.6-.5.8-1.9-1.5-2.2 2.5-2.5 2.2 1.5 1.9-.8z" fill="#C9D3E6"/><circle cx="12" cy="12" r="3" fill="#1D2942"/>`),
  close: s(`<path d="M6 6l12 12M18 6L6 18" stroke="#FFF8E6" stroke-width="3.4"/>`),
  menu: s(`<path d="M5 7h14M5 12h14M5 17h14" stroke="#FFF8E6" stroke-width="3"/>`),
  egg: s(`<path d="M12 2.8c3.8 0 6.6 6 6.6 10.4A6.6 6.6 0 0 1 5.4 13.2C5.4 8.8 8.2 2.8 12 2.8z" fill="#FFF3D6"/><path d="M8.6 13.6c.4 1.8 1.6 3 3.2 3.4" fill="none" stroke="#E8C98A" stroke-width="1.4"/>`),
  home: s(`<path d="M3.6 11L12 3.6 20.4 11" fill="none"/><path d="M5.6 9.6V20h12.8V9.6L12 4z" fill="#FFF8E6"/><path d="M10 20v-5.4h4V20" fill="#F16E60"/>`),
  ad: s(`<rect x="3" y="5" width="18" height="14" rx="3" fill="#1D2942" stroke="#FFF8E6"/><path d="M10 9l5 3-5 3z" fill="#FFF8E6" stroke-width="0"/>`),
  lock: s(`<path d="M7.6 10V8a4.4 4.4 0 0 1 8.8 0v2" fill="none"/><rect x="5" y="10" width="14" height="10" rx="2.4" fill="#FFC94D"/>`),
  star: s(`<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="#FFC94D"/>`),
  sound: s(`<path d="M4 9.4h3.6L12 5.4v13.2l-4.4-4H4z" fill="#FFF8E6"/><path d="M15.4 9a4.4 4.4 0 0 1 0 6M17.8 6.6a7.8 7.8 0 0 1 0 10.8" fill="none" stroke="#FFF8E6" stroke-width="2.2"/>`),
  music: s(`<path d="M9 17V5.6l10-2V15" fill="none" stroke="#FFF8E6" stroke-width="2.2"/><circle cx="6.6" cy="17" r="2.6" fill="#FFF8E6"/><circle cx="16.6" cy="15" r="2.6" fill="#FFF8E6"/>`),
  moon: s(`<path d="M15.6 3.6A8.4 8.4 0 1 0 20.4 15 6.6 6.6 0 0 1 15.6 3.6z" fill="#FFE08A"/>`),
  caught: s(`<circle cx="12" cy="12" r="9" fill="#FFC94D"/><path d="M7.4 8.4l3 3M10.4 8.4l-3 3M13.6 8.4l3 3M16.6 8.4l-3 3" stroke-width="1.6"/><ellipse cx="12" cy="16.2" rx="2.6" ry="1.8" fill="#1D2942"/>`),
  boost: s(`<path d="M12 2.6c3 2 4.6 5.4 4.6 9.4l-2 4.4H9.4l-2-4.4c0-4 1.6-7.4 4.6-9.4z" fill="#FFF8E6"/><circle cx="12" cy="9.4" r="1.8" fill="#6FA8FF"/><path d="M9.4 16.4L12 21l2.6-4.6z" fill="#F16E60"/>`),
  cam: s(`<path d="M3 8.4h4l1.6-2.4h6.8L17 8.4h4V19H3z" fill="#6FA8FF"/><circle cx="12" cy="13.4" r="3.6" fill="#FFF8E6"/>`),
  map: s(`<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="#9BE07F"/><path d="M9 4v14M15 6v14" stroke-width="1.4"/>`),
  check: s(`<path d="M5 12.6l4.4 4.4L19 7.4" fill="none" stroke="#55C879" stroke-width="3.4"/>`),
};

// Painted icon set (assets/ui/ic, drawn to match the Toybox Farm UI) replaces the flat SVGs above;
// the SVGs stay as the fallback for anything not painted.
const PAINTED = ['coin', 'income', 'speed', 'shop', 'pets', 'index', 'gift', 'rebirth', 'gear', 'close', 'egg', 'home', 'ad', 'lock', 'star',
  'sound', 'music', 'moon', 'caught', 'boost', 'map', 'check', 'pen', 'menu', 'hen', 'turkey', 'goose', 'ostrich', 'phoenix', 'sparkle'];
for (const n of PAINTED) ICONS[n] = `<img src="./assets/ui/ic/${n}.webp" alt="" draggable="false">`;
export const BIRD_ICONS = ['hen', 'turkey', 'goose', 'ostrich', 'phoenix'];   // zone order

// <span class="i i-coin"></span>-style markup for innerHTML
export const icon = (name, cls = '') => `<span class="i i-${name} ${cls}">${ICONS[name] || ''}</span>`;

// fill every [data-icon] element in the page once
export function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.dataset.iconDone) continue;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.dataset.iconDone = '1';
  }
}
