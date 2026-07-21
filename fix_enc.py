import path as _p
path = _p.Path('scripts/android-phone-debug.ps1')
text = path.read_text(encoding='utf-8')
replacements = {
    '\u2014': '-',
    '\u2013': '-',
    '\u2192': '->',
    '\u00d7': 'x',
}
for k, v in replacements.items():
    text = text.replace(k, v)
non = sorted({c for c in text if ord(c) > 127})
if non:
    raise SystemExit('remaining non-ASCII: ' + ', '.join(hex(ord(c)) for c in non))
path.write_text(text, encoding='utf-8', newline='\n')
print('ok')
