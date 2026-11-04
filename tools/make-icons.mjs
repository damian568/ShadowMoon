// Renders the ShadowMoon icon set from SVG.
// Usage: npm i --no-save sharp && node tools/make-icons.mjs assets
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
mkdirSync(out, { recursive: true });

// Seeded stars so the result is stable.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const stars = Array.from({ length: 38 }, () => {
  const x = rand() * 1024, y = rand() * 640, r = 1.5 + rand() * 3.5, o = 0.35 + rand() * 0.6;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" opacity="${o.toFixed(2)}"/>`;
}).join('');

const sparkle = (x, y, s, o = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" opacity="${o}" fill="#F3EEFF" d="M0 -40 C4 -8 8 -4 40 0 C8 4 4 8 0 40 C-4 8 -8 4 -40 0 C-8 -4 -4 -8 0 -40Z"/>`;

// Moon + book artwork (no background), centered in 1024 box.
const art = ({ mono = false } = {}) => {
  const moonFill = mono ? '#fff' : 'url(#moonGrad)';
  const pageL = mono ? '#fff' : 'url(#pageL)';
  const pageR = mono ? '#fff' : 'url(#pageR)';
  const line = mono ? '#000' : '#8E7FD9';
  return `
  <g>
    ${mono ? '' : '<circle cx="512" cy="420" r="300" fill="url(#glow)"/>'}
    <!-- crescent moon -->
    <mask id="crescent">
      <rect width="1024" height="1024" fill="#fff"/>
      <circle cx="610" cy="345" r="215" fill="#000"/>
    </mask>
    <circle cx="512" cy="430" r="250" fill="${moonFill}" mask="url(#crescent)"/>
    ${mono ? '' : sparkle(735, 250, 1.1) + sparkle(800, 420, 0.55, 0.85) + sparkle(680, 520, 0.4, 0.7)}
    <!-- open book -->
    <g transform="translate(0 6)">
      ${mono ? '' : '<ellipse cx="512" cy="905" rx="300" ry="26" fill="#000" opacity="0.35"/>'}
      <path d="M512 740 C 430 690, 300 676, 190 700 L 190 868 C 300 846, 430 856, 512 900 Z" fill="${pageL}"/>
      <path d="M512 740 C 594 690, 724 676, 834 700 L 834 868 C 724 846, 594 856, 512 900 Z" fill="${pageR}"/>
      ${mono ? '' : '<path d="M512 740 L 512 900" stroke="#5B4BB0"'} ${mono ? '' : ' stroke-width="6" stroke-linecap="round"/>'}
      ${(mono ? [] : [0, 1, 2]).map((i) => {
        const y = 742 + i * 34;
        return `<path d="M250 ${y} C 330 ${y - 14}, 410 ${y - 8}, 470 ${y + 18}" stroke="${line}" stroke-width="9" fill="none" stroke-linecap="round" opacity="${mono ? 1 : 0.55}"/>
                <path d="M774 ${y} C 694 ${y - 14}, 614 ${y - 8}, 554 ${y + 18}" stroke="${line}" stroke-width="9" fill="none" stroke-linecap="round" opacity="${mono ? 1 : 0.55}"/>`;
      }).join('')}
    </g>
  </g>`;
};

const defs = `
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2A1B5E"/>
    <stop offset="0.55" stop-color="#140F33"/>
    <stop offset="1" stop-color="#07060F"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#B9A8FF" stop-opacity="0.55"/>
    <stop offset="0.6" stop-color="#7B68EE" stop-opacity="0.18"/>
    <stop offset="1" stop-color="#7B68EE" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="moonGrad" x1="0.2" y1="0.1" x2="0.7" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/>
    <stop offset="0.5" stop-color="#E4DCFF"/>
    <stop offset="1" stop-color="#A996FF"/>
  </linearGradient>
  <linearGradient id="pageL" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#CFC4FF"/>
    <stop offset="1" stop-color="#F4F0FF"/>
  </linearGradient>
  <linearGradient id="pageR" x1="1" y1="0" x2="0" y2="0">
    <stop offset="0" stop-color="#B8AAFF"/>
    <stop offset="1" stop-color="#ECE6FF"/>
  </linearGradient>
</defs>`;

const svg = (body, bg = true) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
${defs}
${bg ? `<rect width="1024" height="1024" fill="url(#bg)"/><g>${stars}</g>` : ''}
${body}
</svg>`;

// Scale the artwork into a smaller centered area (for adaptive icons / splash safe zones).
const scaled = (body, s) => `<g transform="translate(${512 - 512 * s} ${512 - 512 * s}) scale(${s})">${body}</g>`;

const render = (str, file, size = 1024) =>
  sharp(Buffer.from(str)).resize(size, size).png().toFile(join(out, file));

await render(svg(art()), 'icon.png');
await render(svg(scaled(art(), 0.62), false), 'splash-icon.png');
await render(svg(scaled(art(), 0.66), false), 'android-icon-foreground.png');
await render(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${defs}<rect width="1024" height="1024" fill="url(#bg)"/>${stars}</svg>`,
  'android-icon-background.png',
);
await render(svg(scaled(art({ mono: true }), 0.66), false), 'android-icon-monochrome.png');
await render(svg(art()), 'favicon.png', 48);
console.log('icons written to', out);
