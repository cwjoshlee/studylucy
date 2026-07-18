import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outline = "#5a4a6f";
const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <g stroke="${outline}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    ${body.trim()}
  </g>
</svg>\n`;

const assets = {
  lumi: wrap(`
    <path fill="#a98bd7" d="M62 217c5-47 29-72 58-72s53 25 58 72z"/>
    <ellipse fill="#fff1dc" cx="120" cy="126" rx="61" ry="57"/>
    <ellipse fill="#f7eaff" cx="87" cy="58" rx="22" ry="48" transform="rotate(-10 87 58)"/>
    <ellipse fill="#ffd9d1" cx="87" cy="58" rx="9" ry="32" transform="rotate(-10 87 58)"/>
    <ellipse fill="#f7eaff" cx="151" cy="55" rx="21" ry="47" transform="rotate(12 151 55)"/>
    <ellipse fill="#ffd9d1" cx="151" cy="55" rx="9" ry="31" transform="rotate(12 151 55)"/>
    <circle fill="#5a4a6f" stroke="none" cx="98" cy="124" r="5"/>
    <circle fill="#5a4a6f" stroke="none" cx="142" cy="124" r="5"/>
    <path fill="none" d="M108 143q12 12 24 0"/>
    <path fill="#ffd96a" d="m194 89 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z"/>
    <path fill="none" d="m190 127-27 75"/>
    <path fill="#d8f2ff" d="M184 39q19-8 29 6l-8 18q-18-3-31 8l-8-17q9-10 18-15z"/>
    <path fill="none" d="m177 49 27 7m-31 4 27 7"/>
  `),
  toto: wrap(`
    <path fill="#9a6248" d="M60 209q-17-33 6-57l31 20-8 42z"/>
    <ellipse fill="#a96f4f" cx="124" cy="154" rx="61" ry="67"/>
    <circle fill="#b87d59" cx="120" cy="90" r="57"/>
    <circle fill="#b87d59" cx="75" cy="55" r="18"/><circle fill="#b87d59" cx="165" cy="55" r="18"/>
    <ellipse fill="#f4d5b8" cx="120" cy="107" rx="40" ry="29"/>
    <circle fill="#5a4a6f" stroke="none" cx="98" cy="84" r="5"/>
    <circle fill="#5a4a6f" stroke="none" cx="142" cy="84" r="5"/>
    <ellipse fill="#5a4a6f" stroke="none" cx="120" cy="103" rx="7" ry="5"/>
    <path fill="none" d="M109 113q11 11 22 0"/>
    <rect fill="#bcebd9" x="102" y="145" width="76" height="61" rx="8"/>
    <path fill="none" d="M120 163h22m-22 14h34m-34 14h26"/>
    <path fill="#ef9b8f" d="M175 173l25-28 10 9-27 26z"/>
    <path fill="#ffd4a3" d="m200 145 8-11 5 14z"/>
  `),
  momo: wrap(`
    <path fill="#8c7c82" d="M172 153q53 7 42 44-8 29-53 11 30-9 16-27-9-12-29-12z"/>
    <path fill="none" d="M178 166q19 4 30 18m-38 1q20 2 34 18"/>
    <ellipse fill="#94868b" cx="116" cy="158" rx="59" ry="65"/>
    <circle fill="#a4999d" cx="116" cy="91" r="57"/>
    <path fill="#625b68" d="M72 78q23-31 44-7-18 30-45 25z"/>
    <path fill="#625b68" d="M160 78q-23-31-44-7 18 30 45 25z"/>
    <path fill="#a4999d" d="m72 50 10-30 28 28zm88 0-10-30-28 28z"/>
    <circle fill="#fff" cx="94" cy="82" r="10"/><circle fill="#fff" cx="138" cy="82" r="10"/>
    <circle fill="#5a4a6f" stroke="none" cx="94" cy="82" r="5"/><circle fill="#5a4a6f" stroke="none" cx="138" cy="82" r="5"/>
    <ellipse fill="#5a4a6f" stroke="none" cx="116" cy="105" rx="7" ry="5"/>
    <path fill="none" d="M105 116q11 10 22 0"/>
    <path fill="#a6dcf5" d="M65 154h84v58H65z"/>
    <path fill="#ffd96a" d="M76 162h60v30H76z"/>
    <path fill="none" d="M86 168v18m20-18v18m20-18v18"/>
    <circle fill="#9b65b5" cx="86" cy="174" r="7"/><circle fill="#9b65b5" cx="106" cy="181" r="7"/><circle fill="#9b65b5" cx="126" cy="173" r="7"/>
  `),
  bongbong: wrap(`
    <path fill="#6fd0c2" d="M72 145q-39-16-47 20 24-7 45 19zm96 0q39-16 47 20-24-7-45 19z"/>
    <ellipse fill="#f4a78e" cx="120" cy="158" rx="58" ry="65"/>
    <circle fill="#ffb39c" cx="120" cy="92" r="55"/>
    <path fill="#fff1dc" d="m78 52 6-29 21 26zm84 0-6-29-21 26z"/>
    <circle fill="#5a4a6f" stroke="none" cx="99" cy="87" r="5"/><circle fill="#5a4a6f" stroke="none" cx="141" cy="87" r="5"/>
    <path fill="none" d="M108 110q12 12 24 0"/>
    <path fill="#ffd96a" d="m87 41 8-28 25 17 24-17 9 28-33-8z" transform="rotate(12 120 30)"/>
    <circle fill="#d7f4ff" fill-opacity=".72" cx="183" cy="75" r="21"/>
    <circle fill="#e9ddff" fill-opacity=".72" cx="208" cy="112" r="14"/>
    <circle fill="#fff2b9" fill-opacity=".8" cx="178" cy="125" r="11"/>
    <path fill="#ffd96a" d="m182 66 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" stroke-width="2"/>
  `)
};

const output = resolve("public/assets/companions");
await mkdir(output, { recursive: true });
await Promise.all(Object.entries(assets).map(([id, svg]) =>
  writeFile(resolve(output, `${id}.svg`), svg, "utf8")
));
