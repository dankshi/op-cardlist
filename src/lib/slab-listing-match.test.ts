import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expectedVariant, variantMatch, titleIsSpecialVariant } from './slab-listing-match'

test('expectedVariant — parallel suffix → special', () => {
  assert.equal(expectedVariant('OP13-118_p3', null), 'special')
  assert.equal(expectedVariant('OP13-118', null), 'base')
})

test('expectedVariant — TCGplayer name keywords → special', () => {
  assert.equal(expectedVariant('OP13-118', 'Monkey.D.Luffy (Red Super Alternate Art)'), 'special')
  assert.equal(expectedVariant('OP13-118', 'Monkey.D.Luffy (Manga)'), 'special')
  assert.equal(expectedVariant('OP13-118', 'Monkey.D.Luffy (118)'), 'base')
})

test('titleIsSpecialVariant — common phrasings', () => {
  assert.ok(titleIsSpecialVariant('OP13-118 Luffy Alt Art PSA 10'))
  assert.ok(titleIsSpecialVariant('Luffy Manga Rare CGC 9.8'))
  assert.ok(titleIsSpecialVariant('Ace OP13-119 Parallel BGS 9.5'))
  assert.ok(!titleIsSpecialVariant('OP13-118 Monkey D Luffy PSA 10'))
})

test('no false positive on "sp"/"second" lookalikes', () => {
  assert.ok(!titleIsSpecialVariant('Spider-themed sleeve OP01-001 PSA 10'))
  assert.ok(!titleIsSpecialVariant('Second print OP05-060 PSA 9'))
})

test('base target + special title → mismatch (drop)', () => {
  assert.equal(variantMatch('base', 'OP13-118 Luffy Alt Art PSA 10'), 'mismatch')
})

test('base target + plain title → match', () => {
  assert.equal(variantMatch('base', 'OP13-118 Monkey D Luffy PSA 10'), 'match')
})

test('special target + special title → match', () => {
  assert.equal(variantMatch('special', 'OP13-118 Luffy Super Alt Art PSA 10'), 'match')
})

test('special target + terse title → uncertain (keep + flag)', () => {
  assert.equal(variantMatch('special', 'OP13-118 Monkey D Luffy PSA 10'), 'uncertain')
})
