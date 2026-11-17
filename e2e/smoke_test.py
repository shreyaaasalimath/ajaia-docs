# Browser smoke test (Playwright). Run against a FRESH database:
#   pip install playwright && python -m playwright install chromium
#   npm run build && npm start   (in another terminal)
#   python e2e/smoke_test.py
# Covers: login, create, rename, formatting, autosave, reload persistence,
# import, sharing as viewer/editor, read-only UI, flush-on-switch. Saves screenshots to docs/screenshots/.
import re, time
from playwright.sync_api import sync_playwright
import os
BASE=os.environ.get('BASE_URL','http://localhost:3001')
SS=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','docs','screenshots','')
errors=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':1360,'height':860})
    pg=ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type=='error' and errors.append(m.text))
    pg.goto(BASE); pg.wait_for_selector('.login-card')
    pg.screenshot(path=SS+'01-login.png')
    pg.click('button:has-text("Sign in")'); pg.wait_for_selector('.sidebar')
    # open welcome doc
    pg.click('.doc-link:has-text("Welcome")'); pg.wait_for_selector('.ProseMirror h1')
    pg.screenshot(path=SS+'02-editor-owner.png')
    # new doc, rename, format
    old=pg.url
    pg.click('.sidebar >> text=+ New document'); pg.wait_for_function('u => location.href !== u', arg=old)
    pg.wait_for_function("document.querySelector('.title-input')?.value === 'Untitled document'")
    pg.fill('.title-input','Q1 Launch Plan')
    ed=pg.locator('.ProseMirror'); ed.click()
    pg.select_option('.tool-select','h2'); pg.keyboard.type('Goals')
    pg.keyboard.press('Enter')
    pg.keyboard.press('Control+b'); pg.keyboard.type('Bold'); pg.keyboard.press('Control+b')
    pg.keyboard.type(' and '); pg.keyboard.press('Control+i'); pg.keyboard.type('italic'); pg.keyboard.press('Control+i')
    pg.keyboard.type(' and '); pg.keyboard.press('Control+u'); pg.keyboard.type('underline'); pg.keyboard.press('Control+u')
    pg.keyboard.press('Enter'); pg.click('button[title="Bulleted list"]'); pg.keyboard.type('First bullet'); pg.keyboard.press('Enter'); pg.keyboard.type('Second bullet')
    pg.wait_for_selector('.status.saved', timeout=5000)
    # share with bob as viewer
    pg.click('button:has-text("Share")'); pg.fill('.share-form input','bob@ajaia.test'); pg.select_option('.share-form select','viewer'); pg.click('.share-form button')
    pg.wait_for_selector('.share-list li:has-text("Bob")')
    pg.screenshot(path=SS+'03-share-panel.png')
    # reload -> persisted
    pg.reload(); pg.wait_for_selector('.ProseMirror h2')
    html=pg.inner_html('.ProseMirror')
    assert '<strong>Bold</strong>' in html and '<em>italic</em>' in html and '<u>underline</u>' in html and '<ul>' in html, html
    assert pg.input_value('.title-input')=='Q1 Launch Plan'
    print('persist OK')
    # import md
    open(os.path.join(os.environ.get('TMPDIR','/tmp'),'notes.md'),'w').write('# Imported Notes\n\n- **one**\n- two\n\nSome *text*.')
    pg.set_input_files('.sidebar input[type=file]',os.path.join(os.environ.get('TMPDIR','/tmp'),'notes.md')); pg.wait_for_selector('.ProseMirror h1:has-text("Imported Notes")')
    print('import OK', pg.input_value('.title-input'))
    pg.click('button:has-text("Sign out")'); pg.wait_for_selector('.login-card')
    # bob
    pg.click('.demo-user:has-text("Bob")'); pg.click('button:has-text("Sign in")'); pg.wait_for_selector('.sidebar')
    pg.wait_for_selector('nav >> text=Q1 Launch Plan')
    pg.screenshot(path=SS+'04-bob-shared-list.png')
    pg.click('.doc-link:has-text("Q1 Launch Plan")'); pg.wait_for_selector('.badge.viewer')
    assert pg.get_attribute('.ProseMirror','contenteditable')=='false'
    assert pg.locator('.toolbar').count()==0
    pg.screenshot(path=SS+'05-bob-view-only.png')
    print('viewer OK')
    pg.click('.doc-link:has-text("Welcome")'); pg.wait_for_selector('.badge.editor')
    pg.locator('.ProseMirror').click(); pg.keyboard.press('Control+End'); pg.keyboard.type(' Bob was here.')
    pg.wait_for_selector('.status.saved', timeout=5000)
    print('editor OK')
    # Switch away immediately after typing: pending edit must still be saved.
    pg.keyboard.type(' QUICKSWITCH')
    pg.click('.doc-link:has-text("Q1 Launch Plan")'); pg.wait_for_selector('.badge.viewer')
    pg.click('.doc-link:has-text("Welcome")'); pg.wait_for_selector('.badge.editor')
    pg.wait_for_timeout(500); pg.reload(); pg.wait_for_selector('.ProseMirror h1')
    assert 'QUICKSWITCH' in pg.inner_text('.ProseMirror'), 'pending edit lost on switch'
    print('flush-on-switch OK')
    b.close()
print('console errors:', errors)
