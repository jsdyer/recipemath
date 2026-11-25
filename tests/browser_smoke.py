"""Exercise real CNF data and private recipe workflows at a project subpath."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    screenshots = ROOT / 'browser-checks'; screenshots.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        shutil.copytree(ROOT / 'dist', Path(temporary) / 'recipemath')
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as p:
                chrome = os.environ.get('CHROME_PATH') or shutil.which('google-chrome') or shutil.which('chromium')
                if not chrome:
                    raise RuntimeError('Set CHROME_PATH to installed Google Chrome or Chromium')
                browser = p.chromium.launch(executable_path=chrome, args=['--no-sandbox'])
                page = browser.new_page(viewport={'width':1440,'height':1100})
                page.route('**/assets/tool-metrics.js', lambda route:route.fulfill(status=200,body=''))
                errors=[]; page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('dialog',lambda dialog:dialog.accept())
                page.goto(f'http://127.0.0.1:{server.server_port}/recipemath/')
                expect(page.locator('#catalogue-count')).to_have_text('5,993 Canadian foods')
                assert page.evaluate('localStorage.length')==0
                page.locator('#search').fill('banana raw');page.locator('#find').click()
                page.locator('.food-result').filter(has_text='Banana, raw').click()
                expect(page.locator('#food-detail')).to_be_visible()
                page.locator('#add-amount').fill('200');page.locator('#add-ingredient').click()
                expect(page.locator('.ingredient')).to_have_count(1)
                expect(page.locator('.macro').first).to_contain_text('45')  # CNF banana 89 kcal/100g, 200g / 4 = 44.5
                page.locator('#recipe-name').fill('Banana breakfast')
                page.locator('#servings').fill('2')
                expect(page.locator('.macro').first).to_contain_text('89')
                page.locator('#final-weight').fill('150')
                page.locator('[data-basis="100g"]').click()
                expect(page.locator('#weight-note')).to_contain_text('150 g finished dish weight')
                page.locator('[data-basis="serving"]').click()
                page.locator('[data-view="compare"]').click();page.locator('#set-baseline').click()
                expect(page.locator('#comparison')).to_contain_text('Baseline')
                page.locator('[data-view="recipe"]').click()
                page.locator('.ingredient input').fill('100')
                page.locator('[data-view="compare"]').click()
                expect(page.locator('#comparison')).to_contain_text('-45')
                page.locator('[data-view="recipe"]').click()
                page.locator('#servings').fill('0')
                expect(page.locator('#recipe-error')).to_be_visible()
                expect(page.locator('.macro')).to_have_count(0)
                page.locator('#servings').fill('2')
                assert page.evaluate('localStorage.length')==0
                page.locator('#save-recipe').click()
                assert len(json.loads(page.evaluate("localStorage.getItem('coolcode:recipemath:recipes:v1')")))==1
                with page.expect_download() as download_info:page.locator('#export-json').click()
                download=download_info.value;download_path=Path(temporary)/'recipe.json';download.save_as(download_path)
                exported=json.loads(download_path.read_text());assert exported['ingredients'][0]['food']['source']=='CNF 2026'
                page.locator('#new-recipe').click();expect(page.locator('.ingredient')).to_have_count(0)
                page.locator('[data-view="saved"]').click();expect(page.locator('#saved-list')).to_contain_text('Banana breakfast')
                page.locator('#import-file').set_input_files(str(download_path))
                expect(page.locator('.ingredient')).to_have_count(1)
                expect(page.locator('#recipe-name')).to_have_value('Banana breakfast')
                # Manual food gaps must display as partial, and names must never become HTML.
                page.locator('.manual summary').click()
                page.locator('#manual-name').fill('<img src=x onerror="alert(1)"> Test label')
                page.locator('#manual-energy').fill('200')
                page.locator('#manual-form button').click();page.locator('#add-ingredient').click()
                expect(page.locator('.ingredient')).to_have_count(2)
                expect(page.locator('#nutrition-output')).to_contain_text('Partial subtotal')
                assert page.locator('img').count()==0
                # Live USDA contract is tested independently of owner key / upstream availability.
                def fdc(route):
                    if '/search?' in route.request.url:
                        data={'foods':[{'fdcId':123,'description':'Test oats','dataType':'Foundation'}],'totalHits':1,'totalPages':1}
                    else:
                        data={'fdcId':123,'description':'Test oats','dataType':'Foundation','publicationDate':'2026-01-01','foodNutrients':[{'nutrient':{'id':2048,'unitName':'KCAL'},'amount':350},{'nutrient':{'id':1003,'unitName':'G'},'amount':13}], 'foodPortions':[{'portionDescription':'1 cup','gramWeight':80}]}
                    route.fulfill(content_type='application/json',body=json.dumps({'fetched_at':'2026-11-25T00:00:00Z','data':data}),headers={'Access-Control-Allow-Origin':'*'})
                page.route('**/api/recipemath/**',fdc)
                page.locator('#catalogue').select_option('fdc');page.locator('#search').fill('oats');page.locator('#find').click()
                page.locator('.food-result').filter(has_text='Test oats').click()
                expect(page.locator('#food-detail')).to_contain_text('USDA FoodData Central · Foundation')
                expect(page.locator('#food-detail')).to_contain_text('fdc:123')
                page.locator('#add-unit').select_option('portion:0');page.locator('#add-ingredient').click()
                expect(page.locator('.ingredient')).to_have_count(3)
                page.unroute('**/api/recipemath/**');page.route('**/api/recipemath/**',lambda route:route.fulfill(status=503,body='{}',headers={'Access-Control-Allow-Origin':'*'}))
                page.locator('#search').fill('different');page.locator('#find').click()
                expect(page.locator('#search-status')).to_contain_text('Canadian catalogue remains available')
                page.locator('#catalogue').select_option('cnf');page.locator('#search').fill('lentils');page.locator('#find').click()
                expect(page.locator('.food-result').first).to_be_visible()
                page.locator('.manual summary').click()
                page.screenshot(path=str(screenshots/'desktop.png'),full_page=True)
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                page.screenshot(path=str(screenshots/'mobile.png'),full_page=True)
                assert not errors,errors
                browser.close()
            print('Browser checks passed: full CNF, calculations, saved snapshots, import/export, missing nutrients, USDA contract/outage, safe text, subpath and mobile')
        finally:server.shutdown()

if __name__=='__main__':main()
