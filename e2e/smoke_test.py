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
    pg.click('.sidebar-actions button:has-text("New document")'); pg.wait_for_function('u => location.href !== u', arg=old)
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
    pg.click('button[aria-label="Sign out"]'); pg.wait_for_selector('.login-card')
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

    # ---- Two browsers on the same doc: presence, live updates, history, outline, search ----
    def login(ctx, who):
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE); page.wait_for_selector('.login-card')
        page.click(f'.demo-user:has-text("{who}")'); page.click('button:has-text("Sign in")')
        page.wait_for_selector('.sidebar')
        return page
    a = login(b.new_context(viewport={'width':1360,'height':860}), 'Alice')
    bob = login(b.new_context(viewport={'width':1360,'height':860}), 'Bob')
    a.click('.doc-link:has-text("Welcome")'); a.wait_for_selector('.ProseMirror h1')
    bob.click('.doc-link:has-text("Welcome")'); bob.wait_for_selector('.ProseMirror h1')
    a.wait_for_selector('.presence .avatar[title*="Bob"]', timeout=10000)
    bob.wait_for_selector('.presence .avatar[title*="Alice"]', timeout=10000)
    print('presence OK')

    a.locator('.ProseMirror').click()
    # Put the caret at the very end of the document (keyboard End only reaches the visual line end).
    a.evaluate("""() => { const el = document.querySelector('.ProseMirror').lastElementChild;
      const last = el.querySelector('li:last-child') || el; const r = document.createRange();
      r.selectNodeContents(last); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    a.wait_for_timeout(100); a.keyboard.press('Enter'); a.keyboard.press('Enter')
    a.select_option('.tool-select','h2'); a.keyboard.type('Live update from Alice')
    a.wait_for_selector('.status.saved', timeout=5000)
    bob.wait_for_selector('.ProseMirror h2:has-text("Live update from Alice")', timeout=12000)
    a.screenshot(path=SS+'06-presence-alice.png')
    print('live update OK')

    # Outline lists headings, including the new one
    a.click('button:has-text("Outline")'); a.wait_for_selector('.outline-list button:has-text("Live update from Alice")')
    a.screenshot(path=SS+'07-outline.png')
    a.click('button:has-text("Outline")')
    print('outline OK')

    # History: preview the original and restore it
    a.click('button:has-text("History")'); a.wait_for_selector('.version-list .version')
    a.click('.version-list li:last-child .version')  # oldest entry: "Created" or "Original version"; a.wait_for_selector('.preview-body h1')
    a.wait_for_selector('.preview-head button:not([disabled])'); a.wait_for_timeout(300)
    a.screenshot(path=SS+'08-history.png')
    a.once('dialog', lambda d: d.accept())
    a.click('button:has-text("Restore this version")')
    a.wait_for_selector('.version-list .version:has-text("Restored")', timeout=8000)
    assert 'Live update from Alice' not in a.inner_text('.ProseMirror'), 'restore did not apply'
    bob.wait_for_function("!document.querySelector('.ProseMirror').innerText.includes('Live update from Alice')", timeout=12000)
    print('history restore OK (and propagated to Bob)')

    # Search filters the sidebar
    a.keyboard.press('Escape'); a.locator('.page').click(position={'x':5,'y':5})
    a.fill('.search input', 'launch')
    assert a.locator('nav .doc-link').count() == 1, a.locator('nav .doc-link').all_inner_texts()
    a.fill('.search input', '')
    print('search OK')

    # Make a copy (from the ⋯ menu) opens a new doc owned by the current user
    old = a.url
    a.click('summary[aria-label="More actions"]'); a.click('.menu-items button:has-text("Make a copy")')
    a.wait_for_function('u => location.href !== u', arg=old)
    a.wait_for_function("document.querySelector('.title-input')?.value === 'Copy of Welcome to Ajaia Docs'")
    print('make a copy OK')

    a.goto(BASE + '/#/'); a.wait_for_selector('.doc-card')
    a.screenshot(path=SS+'00-home.png')
    b.close()
print('console errors:', errors)
