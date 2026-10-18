import { describe, expect, it } from 'vitest';

import { normalize, singularize, tokenize } from '../../src/domain/normalize.js';

describe('tokenize', () => {
  it('lowercases, strips punctuation and diacritics, and splits on non-alphanumerics', () => {
    expect(tokenize('Air-Filters!')).toEqual(['air', 'filters']);
    expect(tokenize('Café  Crème')).toEqual(['cafe', 'creme']);
  });

  it('returns nothing for empty or punctuation-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(' -- !! ')).toEqual([]);
  });
});

describe('singularize', () => {
  it.each([
    ['filters', 'filter'],
    ['pads', 'pad'],
    ['batteries', 'battery'],
    ['boxes', 'box'],
    ['switches', 'switch'],
    ['glasses', 'glass'],
    ['glass', 'glass'],
    ['status', 'status'],
    ['analysis', 'analysis'],
    ['ties', 'tie'],
    ['filter', 'filter'],
  ])('%s -> %s', (word, expected) => {
    expect(singularize(word)).toBe(expected);
  });

  it('leaves short words and tokens containing digits alone', () => {
    expect(singularize('gas')).toBe('gas');
    expect(singularize('bus')).toBe('bus');
    expect(singularize('10pcs')).toBe('10pcs');
  });
});

describe('normalize', () => {
  it('makes plurals, case and punctuation irrelevant', () => {
    expect(normalize('Air Filters')).toBe('air filter');
    expect(normalize('air-filter')).toBe('air filter');
  });

  it.each([
    ['compressor two', 'compressor 2'],
    ['Compressor 2', 'compressor 2'],
    ['job one oh eight', 'job 108'],
    ['job one-oh-eight', 'job 108'],
    ['job 108', 'job 108'],
    ['twenty five units', '25 unit'],
    ['twenty-five', '25'],
    ['forty two', '42'],
    ['ninety nine', '99'],
    ['fourteen', '14'],
    ['thirty', '30'],
    ['twenty pads', '20 pad'],
    ['twenty zero', '20 0'],
    ['one oh', '10'],
    ['seven', '7'],
  ])('converts spoken numbers: %s -> %s', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it('leaves a lone "oh" alone', () => {
    expect(normalize('oh no')).toBe('oh no');
  });

  it('is empty for empty input', () => {
    expect(normalize('')).toBe('');
  });
});
