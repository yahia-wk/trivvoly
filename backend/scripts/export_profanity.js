// Regenerates backend/trivvoly/data/profanity_en.json from the obscenity library's English dataset.
// Only needed to update the word list. From the repo root:
//   npm install --no-save obscenity@0.4.6
//   node backend/scripts/export_profanity.js
'use strict';
const fs = require('fs');
const path = require('path');
const { englishDataset } = require('obscenity');

const built = englishDataset.build();
const escapeChar = c => String.fromCharCode(c).replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch);
// Pattern nodes: 0 = optional part, 1 = any one character, 2 = literal characters
function toRegex(node) {
  if (node.kind === 2) return node.chars.map(escapeChar).join('');
  if (node.kind === 1) return '.';
  if (node.kind === 0) return '(?:' + toRegex(node.childNode) + ')?';
  throw new Error('Unknown pattern node kind ' + node.kind);
}
const blacklist = built.blacklistedTerms.map(t => ({
  id: t.id,
  regex: (t.pattern.requireWordBoundaryAtStart ? '(?<![a-z])' : '') + t.pattern.nodes.map(toRegex).join('') + (t.pattern.requireWordBoundaryAtEnd ? '(?![a-z])' : '')
}));
const pkgDir = path.join(process.cwd(), 'node_modules', 'obscenity');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const license = fs.readFileSync(path.join(pkgDir, fs.readdirSync(pkgDir).find(f => /^licen[cs]e/i.test(f))), 'utf8');
const out = path.join(__dirname, '..', 'trivvoly', 'data', 'profanity_en.json');
fs.writeFileSync(out, JSON.stringify({
  source: `English dataset from obscenity ${pkg.version} (https://github.com/jo3-l/obscenity), exported to regular expressions`,
  license, blacklist, whitelist: built.whitelistedTerms
}, null, 1) + '\n');
console.log(`${blacklist.length} patterns written to ${out}`);
