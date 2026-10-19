// Text that players type and other people see: team names (rejected if offensive)
// and dispute reasons (shown on the big screen, so offensive words are starred out).
'use strict';
const { RegExpMatcher, TextCensor, englishDataset, englishRecommendedTransformers } = require('obscenity');

const built = englishDataset.build();
// Innocent words the default list trips over (kept short and specific)
const ALLOWED = ['pussycat', 'pussycats', 'pussy willow', 'dick fosbury', 'moby dick', 'dickens', 'dick turpin', 'dick van dyke', 'cocktail', 'cockatoo', 'cockpit', 'shitake', 'shiitake', 'scunthorpe'];
const matcher = new RegExpMatcher({
  ...built,
  ...englishRecommendedTransformers,
  whitelistedTerms: [...(built.whitelistedTerms || []), ...ALLOWED]
});
const censor = new TextCensor();

// "f u c k" and "f.u.c.k" -> "fuck", so spacing letters out doesn't slip past
const squash = s => s.replace(/\b(\w)[\s._\-*]+(?=\w\b)/g, '$1');

function isOffensive(text) {
  const s = String(text || '');
  return matcher.hasMatch(s) || matcher.hasMatch(squash(s));
}
function clean(text) {
  const s = String(text || '');
  const matches = matcher.getAllMatches(s);
  return matches.length ? censor.applyTo(s, matches) : s;
}

module.exports = { isOffensive, clean };
