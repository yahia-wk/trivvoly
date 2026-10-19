// Built-in flag library. Quizzes refer to flags by id ("flag": "estonia"), never by markup,
// so a quiz file can't inject anything into the page. Loaded by the show page and by the server's validator.
(function (root) {
'use strict';
function starPoly(cx, cy, R, fill) {
  const r = R * 0.382, pts = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 5, rad = k % 2 ? r : R;
    pts.push((cx + rad * Math.cos(a)).toFixed(4) + ',' + (cy + rad * Math.sin(a)).toFixed(4));
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

const FLAGS = {
  czechia: { w: 6, h: 4, svg: '<rect width="6" height="4" fill="#FFFFFF"/><rect y="2" width="6" height="2" fill="#D7141A"/><path d="M0 0L3 2L0 4Z" fill="#11457E"/>' },
  estonia: { w: 33, h: 21, svg: '<rect width="33" height="21" fill="#FFFFFF"/><rect width="33" height="14" fill="#000000"/><rect width="33" height="7" fill="#0072CE"/>' },
  panama: { w: 6, h: 4, svg: '<rect width="6" height="4" fill="#FFFFFF"/><rect x="3" width="3" height="2" fill="#D21034"/><rect y="2" width="3" height="2" fill="#005293"/>' + starPoly(1.5, 1, 0.55, '#005293') + starPoly(4.5, 3, 0.55, '#D21034') },
  myanmar: { w: 18, h: 12, svg: '<rect width="18" height="4" fill="#FECB00"/><rect y="4" width="18" height="4" fill="#34B233"/><rect y="8" width="18" height="4" fill="#EA2839"/>' + starPoly(9, 6.46, 4.8, '#FFFFFF') },
  seychelles: { w: 12, h: 6, svg: '<path d="M0 6L0 0L4 0Z" fill="#003F87"/><path d="M0 6L4 0L8 0Z" fill="#FCD856"/><path d="M0 6L8 0L12 0L12 2Z" fill="#D62828"/><path d="M0 6L12 2L12 4Z" fill="#FFFFFF"/><path d="M0 6L12 4L12 6Z" fill="#007A3D"/>' },
  mauritius: { w: 6, h: 4, svg: '<rect width="6" height="1" fill="#EA2839"/><rect y="1" width="6" height="1" fill="#1A206D"/><rect y="2" width="6" height="1" fill="#FFD500"/><rect y="3" width="6" height="1" fill="#00A551"/>' }
};

if (typeof module !== 'undefined' && module.exports) module.exports = FLAGS;
else root.TRIVVOLY_FLAGS = FLAGS;
})(this);
