import { describe, expect, it } from 'bun:test'
import {
  avoidWindowsReservedFilename,
  isDiscardRedirectTarget,
  isWindowsReservedDevicePath,
  rewriteWindowsNullRedirects,
} from '../windows-null-redirect.ts'

describe('rewriteWindowsNullRedirects', () => {
  it('rewrites cmd.exe NUL redirects that Git Bash would turn into a cwd file', () => {
    expect(rewriteWindowsNullRedirects('del foo 2>nul')).toBe('del foo 2>/dev/null')
    expect(rewriteWindowsNullRedirects('dir >nul')).toBe('dir >/dev/null')
    expect(rewriteWindowsNullRedirects('cmd /c copy a b 2> nul')).toBe('cmd /c copy a b 2>/dev/null')
    expect(rewriteWindowsNullRedirects('echo hi >NUL')).toBe('echo hi >/dev/null')
    expect(rewriteWindowsNullRedirects('foo 2>"nul"')).toBe('foo 2>/dev/null')
    expect(rewriteWindowsNullRedirects('foo &>nul')).toBe('foo &>/dev/null')
    expect(rewriteWindowsNullRedirects('del x 2>nul && echo ok')).toBe('del x 2>/dev/null && echo ok')
    expect(rewriteWindowsNullRedirects('dir 2>./nul')).toBe('dir 2>/dev/null')
    expect(rewriteWindowsNullRedirects('dir 2>nul:')).toBe('dir 2>/dev/null')
    expect(rewriteWindowsNullRedirects('echo hi >>nul')).toBe('echo hi >>/dev/null')
  })

  it('does not rewrite unrelated words or real filenames', () => {
    expect(rewriteWindowsNullRedirects('echo nul')).toBe('echo nul')
    expect(rewriteWindowsNullRedirects('cat annul')).toBe('cat annul')
    expect(rewriteWindowsNullRedirects('echo hi >null')).toBe('echo hi >null')
    expect(rewriteWindowsNullRedirects('ls > /dev/null')).toBe('ls > /dev/null')
    expect(rewriteWindowsNullRedirects('printf a > notes.md')).toBe('printf a > notes.md')
  })
})

describe('windows reserved device paths', () => {
  it('detects NUL and other reserved names including extensions', () => {
    expect(isWindowsReservedDevicePath('nul')).toBe(true)
    expect(isWindowsReservedDevicePath('NUL')).toBe(true)
    expect(isWindowsReservedDevicePath('C:\\\\proj\\\\nul')).toBe(true)
    expect(isWindowsReservedDevicePath('nul.txt')).toBe(true)
    expect(isWindowsReservedDevicePath('con')).toBe(true)
    expect(isWindowsReservedDevicePath('notes.md')).toBe(false)
    expect(isWindowsReservedDevicePath('annul')).toBe(false)
  })

  it('treats nul and /dev/null as discard redirect targets', () => {
    expect(isDiscardRedirectTarget('/dev/null')).toBe(true)
    expect(isDiscardRedirectTarget('nul')).toBe(true)
    expect(isDiscardRedirectTarget('NUL')).toBe(true)
    expect(isDiscardRedirectTarget('$null')).toBe(true)
    expect(isDiscardRedirectTarget('report.md')).toBe(false)
  })

  it('prefixes reserved filenames so they cannot be written as devices', () => {
    expect(avoidWindowsReservedFilename('nul')).toBe('_nul')
    expect(avoidWindowsReservedFilename('notes.md')).toBe('notes.md')
  })
})
