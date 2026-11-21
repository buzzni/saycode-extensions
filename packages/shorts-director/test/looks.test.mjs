import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FONTS } from '../lib/assets.mjs'
import { LOOKS, LOOK_ROLES, designFor } from '../lib/looks.mjs'

const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(left, right) {
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

function alpha(hex) {
  return hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1
}

test('looks differ by genre: at least eight, each says which videos it suits', () => {
  assert.ok(Object.keys(LOOKS).length >= 8)
  for (const [id, look] of Object.entries(LOOKS)) {
    assert.match(id, /^[a-z]+$/)
    assert.ok(look.suits.includes('—'), `${id} names the videos it suits`)
  }
  const hookFonts = new Set(Object.values(LOOKS).map((look) => look.hook.font))
  assert.ok(hookFonts.size >= 5, 'the hook does not look the same in every genre')
})

test('every look styles every role with fonts that can be downloaded and colours that can be read', () => {
  const fonts = new Set(FONTS.map((font) => font.name))
  for (const [id, look] of Object.entries(LOOKS)) {
    for (const role of LOOK_ROLES) {
      const design = look[role]
      assert.ok(design, `${id}.${role}`)
      assert.ok(fonts.has(design.font), `${id}.${role} font ${design.font} is in the OFL font list`)
      for (const key of ['ink', 'fill', 'outline', 'emphasis', 'emphasisFill']) {
        if (design[key] !== undefined) assert.match(design[key], HEX, `${id}.${role}.${key}`)
      }
      assert.ok(['pop', 'fade', 'none'].includes(design.entrance ?? 'none'), `${id}.${role} entrance`)
      if (design.fill && alpha(design.fill) >= 0.6) {
        assert.ok(contrast(design.ink, design.fill.slice(0, 7)) >= 4.5, `${id}.${role}: text on its box (${contrast(design.ink, design.fill.slice(0, 7)).toFixed(1)}:1)`)
      } else {
        assert.ok(design.outline || design.shadow || design.fill, `${id}.${role}: text over footage needs an outline, a shadow or a box`)
        if (design.outline) assert.ok(contrast(design.ink, design.outline) >= 3, `${id}.${role}: outline stands apart from the text`)
      }
    }
  }
})

test('a caption takes its design from the look, and an unknown look falls back to the clean one', () => {
  assert.equal(designFor('news', 'hook').font, LOOKS.news.hook.font)
  assert.deepEqual(designFor('dialogue-free', 'narration'), designFor('clean', 'narration'))
  assert.deepEqual(designFor('vlog', 'dialogue'), designFor('vlog', 'narration'), 'dialogue subtitles look like narration subtitles')
})
