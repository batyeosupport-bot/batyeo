import test from 'node:test';
import assert from 'node:assert/strict';
import {POSTER_LOCALES, POSTER_STRINGS, POSTER_STRING_KEYS, posterAvailability, resolvePosterText} from '../core/poster-i18n';

test('every poster language ships every text, so a venue never shows a blank or a raw key', () => {
 for (const {locale} of POSTER_LOCALES) {
  for (const key of POSTER_STRING_KEYS) assert.ok(POSTER_STRINGS[locale][key].trim(), `${locale}.${key}`);
  assert.match(POSTER_STRINGS[locale].availableOne, /\{count\}/, locale);
  assert.match(POSTER_STRINGS[locale].availableMany, /\{count\}/, locale);
 }
});

test('venue wording overrides the built-in text per language, and blanks fall back to it', () => {
 const custom = resolvePosterText('en-GB', {headlines: ['Match night?', '  '], tagline: ''});
 assert.deepEqual(custom.headlines, ['Match night?']);
 assert.equal(custom.tagline, POSTER_STRINGS['en-GB'].tagline);
 assert.equal(resolvePosterText('es-ES').headlines.length, 3);
});

test('French question marks never wrap alone, and availability picks singular or plural', () => {
 assert.equal(resolvePosterText('fr-FR').headlines[0], 'Batterie à plat ?');
 assert.equal(posterAvailability('fr-FR', 1), '1 batterie disponible');
 assert.equal(posterAvailability('en-GB', 3), '3 batteries available');
});
