import { describe, it, expect } from 'bun:test'
import {
  isEscapeDuringComposition,
  isInputDuringComposition,
  shouldShowRichInputPlaceholder,
} from '../rich-text-input'

describe('isEscapeDuringComposition', () => {
  it('returns true for Escape when local composition ref is active', () => {
    expect(isEscapeDuringComposition({ key: 'Escape' }, true)).toBe(true)
  })

  it('returns true for Escape when nativeEvent.isComposing is true', () => {
    expect(
      isEscapeDuringComposition(
        { key: 'Escape', nativeEvent: { isComposing: true } },
        false
      )
    ).toBe(true)
  })

  it('returns true for Escape when event.isComposing is true', () => {
    expect(isEscapeDuringComposition({ key: 'Escape', isComposing: true }, false)).toBe(true)
  })

  it('returns false for Escape when no composition signal is active', () => {
    expect(isEscapeDuringComposition({ key: 'Escape' }, false)).toBe(false)
  })

  it('returns false for non-Escape keys even if composing', () => {
    expect(isEscapeDuringComposition({ key: 'Enter', isComposing: true }, true)).toBe(false)
  })
})

describe('isInputDuringComposition', () => {
  it('returns true when local composition ref is active', () => {
    expect(isInputDuringComposition({}, true)).toBe(true)
  })

  it('returns true when nativeEvent.isComposing is true', () => {
    expect(isInputDuringComposition({ nativeEvent: { isComposing: true } }, false)).toBe(true)
  })

  it('returns false when no composition signal is active', () => {
    expect(isInputDuringComposition({}, false)).toBe(false)
  })
})

describe('shouldShowRichInputPlaceholder', () => {
  it('hides the placeholder while IME composition is active on an empty input', () => {
    expect(shouldShowRichInputPlaceholder('', true)).toBe(false)
  })

  it('shows the placeholder only when the value is empty and not composing', () => {
    expect(shouldShowRichInputPlaceholder('', false)).toBe(true)
    expect(shouldShowRichInputPlaceholder('hello', false)).toBe(false)
  })
})
