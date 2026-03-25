const fs = require('fs');
const cheerio = require('cheerio');

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim();
}

function decodeHexHtml(rawHtml) {
  const match = rawHtml.match(/pageSanitizer\.sanitize\('([\s\S]+?)'\)(?:\s*;|\s*\})/);
  let str = '';
  if (!match) {
    const match2 = rawHtml.match(/\.innerHTML\s*=\s*pageSanitizer\.sanitize\('([\s\S]+?)'\)/);
    if (!match2) return rawHtml;
    str = match2[1];
  } else {
    str = match[1];
  }
  return decodeHexString(str);
}

function decodeHexString(str) {
  return str.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const raw = fs.readFileSync('last_fetch_My_Attendance.html', 'utf8');
const decoded = decodeHexHtml(raw);

const $1 = cheerio.load(decoded);
console.log(`Original Decoded - Found ${$1('table').length} tables`);

const fixedHtml = decoded.replace(/\\n/g, '\n').replace(/\\\//g, '/').replace(/\\-/g, '-');
const $2 = cheerio.load(fixedHtml);
console.log(`Fixed Html - Found ${$2('table').length} tables`);
