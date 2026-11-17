# Failure-mode browser test (Playwright). Run against a running app:
#   python e2e/reliability_test.py            (BASE_URL defaults to http://localhost:3001)
# Simulates what goes wrong in real use: losing the network mid-edit, having
# access revoked while typing, the session expiring, plus small UX contracts.
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE_URL', 'http://localhost:3001')
# This test runs WITH the Content-Security-Policy enforced (the smoke test bypasses
# it for Playwright's own helpers), so any violation by the app itself fails here.
csp_violations = []


def wait_until(page, check, timeout=10.0, what='condition'):
    # Polls from Python instead of page.wait_for_function, which relies on eval
    # and is blocked by the app's Content-Security-Policy (as it should be).
    # page.wait_for_timeout (not time.sleep) lets Playwright process browser events.
    end = time.time() + timeout
    while time.time() < end:
        if check():
            return
        page.wait_for_timeout(100)
    raise AssertionError(f'timed out waiting for {what}')


def login(browser, who):
    ctx = browser.new_context(viewport={'width': 1360, 'height': 860})
    page = ctx.new_page()
    page.on('console', lambda m: 'Content Security Policy' in m.text and csp_violations.append(m.text))
    page.goto(BASE)
    page.wait_for_selector('.login-card')
    page.click(f'.demo-user:has-text("{who}")')
    page.click('button:has-text("Sign in")')
    page.wait_for_selector('.sidebar')
    return ctx, page


def caret_to_end(page):
    page.locator('.ProseMirror').click()
    page.evaluate("""() => { const el = document.querySelector('.ProseMirror').lastElementChild;
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")


with sync_playwright() as p:
    browser = p.chromium.launch()
    actx, alice = login(browser, 'Alice')

    # A fresh document shared with Bob as editor
    old = alice.url
    alice.click('.sidebar-actions button:has-text("New document")')
    wait_until(alice, lambda: alice.url != old, what='navigation to the new document')
    wait_until(alice, lambda: alice.locator('.title-input').count() > 0
               and alice.input_value('.title-input') == 'Untitled document', what='the new document to open')
    alice.fill('.title-input', 'Reliability')
    alice.wait_for_selector('.status.saved', timeout=5000)
    assert alice.title() == 'Reliability · Ajaia Docs', alice.title()
    print('tab title OK')
    doc_url = alice.url
    doc_id = doc_url.split('/doc/')[1]

    # 1) Offline mid-edit: changes are kept, retried, and saved when back online
    caret_to_end(alice)
    actx.set_offline(True)
    alice.keyboard.type('typed while offline')
    alice.wait_for_selector('.status.retrying', timeout=8000)
    actx.set_offline(False)
    alice.wait_for_selector('.status.saved', timeout=35000)
    alice.reload()
    alice.wait_for_selector('.ProseMirror')
    assert 'typed while offline' in alice.inner_text('.ProseMirror')
    print('offline -> retry -> saved OK')

    # 2) Menu closes on outside click and on Escape
    alice.click('summary[aria-label="More actions"]')
    assert alice.get_attribute('details.menu', 'open') is not None
    alice.mouse.click(700, 600)
    assert alice.get_attribute('details.menu', 'open') is None
    alice.click('summary[aria-label="More actions"]')
    alice.keyboard.press('Escape')
    assert alice.get_attribute('details.menu', 'open') is None
    print('menu outside-click / Escape OK')

    # 3) Access downgraded while Bob is typing: he is switched to read-only, nothing is overwritten
    alice.request.post(f'{BASE}/api/documents/{doc_id}/shares', data={'email': 'bob@ajaia.test', 'role': 'editor'})
    bctx, bob = login(browser, 'Bob')
    bob.goto(doc_url)
    bob.wait_for_selector('.badge.editor')
    alice.request.post(f'{BASE}/api/documents/{doc_id}/shares', data={'email': 'bob@ajaia.test', 'role': 'viewer'})
    caret_to_end(bob)
    bob.keyboard.type(' bob edit after downgrade')
    bob.wait_for_selector('.status.readonly', timeout=8000)
    assert bob.get_attribute('.ProseMirror', 'contenteditable') == 'false'
    server = alice.request.get(f'{BASE}/api/documents/{doc_id}').json()['document']['content']
    assert 'bob edit after downgrade' not in server
    print('revoked edit access -> read-only OK')

    # 4) Session expires mid-use (cookie gone): back to sign-in with an explanation
    bctx.clear_cookies()
    bob.click('.sidebar-actions button:has-text("New document")')
    bob.wait_for_selector('.login-card .notice:has-text("session expired")', timeout=8000)
    print('expired session -> sign-in notice OK')

    browser.close()
assert not csp_violations, csp_violations
print('no CSP violations by the app OK')
print('reliability: all checks passed')
