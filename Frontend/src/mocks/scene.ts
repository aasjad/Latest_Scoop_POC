/**
 * MOCK ONLY — draws a synthetic CCTV corridor and walking people as SVG markup.
 * In production the live camera shows the processed stream from the backend.
 */
import { FRAME } from '@/config/constants';
import { hashString, mulberry32, pick } from './random';

const { w: W, h: H } = FRAME;
export const VP = { x: 800, y: 300 };
export const BACK = { left: 590, right: 1010, top: 190, floor: 330 };

/** Person height in px for a given foot y (perspective). */
export const personHeight = (fy: number) => 110 + ((fy - BACK.floor) / (H - BACK.floor)) * 450;
/** Half-width of walkable floor at a given foot y. */
export const floorHalfWidth = (fy: number) => 200 + ((fy - BACK.floor) / (H - BACK.floor)) * 600;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function wallMullions(side: 'l' | 'r') {
  const depths = [0.12, 0.3, 0.45, 0.57, 0.67, 0.75, 0.82, 0.88];
  return depths
    .map((d) => {
      const x = side === 'l' ? lerp(0, BACK.left, d) : lerp(W, BACK.right, d);
      const top = lerp(0, BACK.top, d);
      const bot = lerp(H, BACK.floor, d);
      return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bot}" stroke="#9fb0bd" stroke-opacity="${0.25 + d * 0.3}" stroke-width="${6 - d * 5}"/>`;
    })
    .join('');
}

function floorLines() {
  const lines: string[] = [];
  for (let i = -6; i <= 6; i++) {
    const bx = 800 + i * 150;
    const tx = 800 + i * 35;
    lines.push(`<line x1="${tx}" y1="${BACK.floor}" x2="${bx}" y2="${H}" stroke="#ffffff" stroke-opacity=".10" stroke-width="2"/>`);
  }
  for (let k = 1; k < 9; k++) {
    const y = BACK.floor + (H - BACK.floor) * Math.pow(k / 9, 1.8);
    lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ffffff" stroke-opacity=".06" stroke-width="2"/>`);
  }
  return lines.join('');
}

function ceilingLights() {
  const out: string[] = [];
  for (let k = 0; k < 7; k++) {
    const t0 = Math.pow(k / 7, 0.75);
    const t1 = Math.pow((k + 0.45) / 7, 0.75);
    const y0 = lerp(0, BACK.top, t0) + 6;
    const y1 = lerp(0, BACK.top, t1) + 6;
    const hw0 = lerp(170, 30, t0);
    const hw1 = lerp(170, 30, t1);
    out.push(`<polygon points="${800 - hw0},${y0} ${800 + hw0},${y0} ${800 + hw1},${y1} ${800 - hw1},${y1}" fill="#f8fbff" opacity=".9"/>`);
  }
  return out.join('');
}

function plant(x: number, y: number, s: number) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="6" rx="46" ry="8" fill="#000" opacity=".25"/>
    <path d="M-30 0 L30 0 L24 -60 L-24 -60Z" fill="#d9dcdf"/>
    <g fill="#2f6a3a"><ellipse cx="-22" cy="-110" rx="26" ry="62" transform="rotate(-24 -22 -110)"/><ellipse cx="20" cy="-118" rx="24" ry="66" transform="rotate(20 20 -118)"/><ellipse cx="0" cy="-140" rx="22" ry="74"/></g>
    <g fill="#3f8a4b" opacity=".85"><ellipse cx="-36" cy="-84" rx="16" ry="44" transform="rotate(-48 -36 -84)"/><ellipse cx="36" cy="-90" rx="16" ry="46" transform="rotate(46 36 -90)"/></g>
  </g>`;
}

/** Static background as a data URI (cached). */
let backgroundUri: string | null = null;
export function corridorBackground() {
  if (backgroundUri) return backgroundUri;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
  <defs>
    <linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d98a1"/><stop offset=".55" stop-color="#6b7680"/><stop offset="1" stop-color="#4b545c"/></linearGradient>
    <linearGradient id="wl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b3740"/><stop offset="1" stop-color="#55646f"/></linearGradient>
    <linearGradient id="wr" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#2b3740"/><stop offset="1" stop-color="#55646f"/></linearGradient>
    <linearGradient id="cl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d252c"/><stop offset="1" stop-color="#3a4650"/></linearGradient>
    <radialGradient id="vg" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
    <linearGradient id="dr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe3ee"/><stop offset="1" stop-color="#94aebd"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#20292f"/>
  <polygon points="0,0 ${W},0 ${BACK.right},${BACK.top} ${BACK.left},${BACK.top}" fill="url(#cl)"/>
  ${ceilingLights()}
  <polygon points="0,0 ${BACK.left},${BACK.top} ${BACK.left},${BACK.floor} 0,${H}" fill="url(#wl)"/>
  <polygon points="${W},0 ${BACK.right},${BACK.top} ${BACK.right},${BACK.floor} ${W},${H}" fill="url(#wr)"/>
  ${wallMullions('l')}${wallMullions('r')}
  <rect x="${BACK.left}" y="${BACK.top}" width="${BACK.right - BACK.left}" height="${BACK.floor - BACK.top}" fill="url(#dr)"/>
  <g stroke="#56636c" stroke-width="5"><line x1="800" y1="${BACK.top}" x2="800" y2="${BACK.floor}"/><line x1="${BACK.left + 105}" y1="${BACK.top}" x2="${BACK.left + 105}" y2="${BACK.floor}"/><line x1="${BACK.right - 105}" y1="${BACK.top}" x2="${BACK.right - 105}" y2="${BACK.floor}"/></g>
  <polygon points="${BACK.left},${BACK.floor} ${BACK.right},${BACK.floor} ${W},${H} 0,${H}" fill="url(#fl)"/>
  <polygon points="${BACK.left + 40},${BACK.floor} ${BACK.right - 40},${BACK.floor} ${1250},${H} ${350},${H}" fill="#ffffff" opacity=".07"/>
  ${floorLines()}
  ${plant(150, 640, 1.25)}${plant(1450, 650, 1.3)}${plant(470, 380, 0.55)}${plant(1130, 382, 0.55)}
  <rect width="${W}" height="${H}" fill="url(#vg)"/>
</svg>`;
  backgroundUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return backgroundUri;
}

const SHIRTS = ['#1f2937', '#334155', '#0f172a', '#7c2d12', '#1e3a8a', '#e5e7eb', '#3f6212', '#4c1d95', '#9f1239', '#f5f5f4', '#475569'];
const PANTS = ['#111827', '#1f2937', '#374151', '#1e3a8a', '#334155', '#44403c'];
const SKIN = ['#f1c7a8', '#d8a07a', '#a8724f', '#7a4b2f', '#e8b896'];
const HAIR = ['#111111', '#2b1d14', '#4a3426', '#6b4f2f', '#1c1917'];

export interface Appearance {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  backpack: boolean;
  build: number;
}

export function appearanceFor(seed: string | number): Appearance {
  const rnd = mulberry32(hashString(String(seed)));
  return { shirt: pick(rnd, SHIRTS), pants: pick(rnd, PANTS), skin: pick(rnd, SKIN), hair: pick(rnd, HAIR), backpack: rnd() < 0.45, build: 0.9 + rnd() * 0.2 };
}

/**
 * A walking figure whose feet are at (fx, fy). `facingAway` = walking away from camera.
 * `phase` animates the stride.
 */
export function figureSvg(fx: number, fy: number, a: Appearance, phase: number, facingAway: boolean) {
  const h = personHeight(fy);
  const bw = 0.27 * h * a.build;
  const swing = Math.sin(phase) * 0.05 * h;
  const hipY = fy - 0.47 * h;
  const shY = fy - 0.81 * h;
  const legW = bw * 0.36;
  const armW = bw * 0.2;
  const headR = 0.068 * h;
  const headY = fy - 0.89 * h;
  const r = (v: number) => v.toFixed(1);
  const bag = a.backpack && facingAway
    ? `<rect x="${r(fx - bw * 0.4)}" y="${r(shY + 0.02 * h)}" width="${r(bw * 0.8)}" height="${r(0.26 * h)}" rx="${r(bw * 0.18)}" fill="#151a1f"/>`
    : '';
  const face = facingAway
    ? `<ellipse cx="${r(fx)}" cy="${r(headY)}" rx="${r(headR * 1.02)}" ry="${r(headR * 1.08)}" fill="${a.hair}"/>`
    : `<ellipse cx="${r(fx)}" cy="${r(headY - headR * 0.35)}" rx="${r(headR * 1.04)}" ry="${r(headR * 0.75)}" fill="${a.hair}"/>`;
  return `<g>
  <ellipse cx="${r(fx)}" cy="${r(fy)}" rx="${r(bw * 0.75)}" ry="${r(h * 0.025)}" fill="#000" opacity=".28"/>
  <rect x="${r(fx - bw * 0.42 + swing * 0.3)}" y="${r(hipY)}" width="${r(legW)}" height="${r(fy - hipY)}" rx="${r(legW * 0.4)}" fill="${a.pants}"/>
  <rect x="${r(fx + bw * 0.06 - swing * 0.3)}" y="${r(hipY)}" width="${r(legW)}" height="${r(fy - hipY)}" rx="${r(legW * 0.4)}" fill="${a.pants}" opacity=".92"/>
  <rect x="${r(fx - bw * 0.62)}" y="${r(shY + 0.02 * h - swing * 0.2)}" width="${r(armW)}" height="${r(0.36 * h)}" rx="${r(armW * 0.5)}" fill="${a.shirt}" opacity=".9"/>
  <rect x="${r(fx + bw * 0.42)}" y="${r(shY + 0.02 * h + swing * 0.2)}" width="${r(armW)}" height="${r(0.36 * h)}" rx="${r(armW * 0.5)}" fill="${a.shirt}" opacity=".9"/>
  <rect x="${r(fx - bw / 2)}" y="${r(shY)}" width="${r(bw)}" height="${r(hipY - shY + 0.03 * h)}" rx="${r(bw * 0.28)}" fill="${a.shirt}"/>
  ${bag}
  <rect x="${r(fx - headR * 0.45)}" y="${r(headY + headR * 0.7)}" width="${r(headR * 0.9)}" height="${r(headR * 0.7)}" fill="${a.skin}"/>
  <circle cx="${r(fx)}" cy="${r(headY)}" r="${r(headR)}" fill="${a.skin}"/>
  ${face}
</g>`;
}

/** Event snapshot (data URI): the corridor with one person inside a coloured box. */
export function snapshotUri(trackId: number, entering: boolean, footY = 600, laneX = 800, facingAway = entering) {
  const a = appearanceFor(`trk-${trackId}`);
  const h = personHeight(footY);
  const bw = h * 0.42;
  const color = entering ? '#22c55e' : '#ef4444';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <image href="${corridorBackground()}" width="${W}" height="${H}" preserveAspectRatio="none"/>
  ${figureSvg(laneX, footY, a, 0.9, facingAway)}
  <rect x="${laneX - bw / 2}" y="${footY - h - 10}" width="${bw}" height="${h + 14}" fill="none" stroke="${color}" stroke-width="7" rx="6"/>
  <rect x="${laneX - bw / 2}" y="${footY - h - 58}" width="150" height="48" rx="6" fill="${color}"/>
  <text x="${laneX - bw / 2 + 14}" y="${footY - h - 24}" font-family="monospace" font-size="30" font-weight="700" fill="#fff">ID ${trackId}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
