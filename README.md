# RecipeMath

A private recipe nutrition workspace at [coolcode.ca/recipemath](https://coolcode.ca/recipemath/). Search the **complete Canadian Nutrient File 2026: 5,993 foods**, use edible portion weights, compare substitutions and save portable recipes. Core functionality needs no API key, account or server.

<!-- coolcode:guide -->
Search for an ingredient in English or French and choose the description matching how you use it: raw, cooked, drained or another preparation. Enter grams, a weight unit or one of that food's supported portions. Add as many ingredients as you need, then set servings. For example, a 400 g dish divided into four servings has 100 g per serving; if cooking reduces it to 320 g, enter that finished weight to calculate nutrition per 100 g of the finished dish. This changes concentration, not the total nutrient estimate or cooking losses.

Capture a comparison baseline before changing an ingredient, then return to Compare a swap to see the difference. Missing nutrient values remain unknown: a partial subtotal lists the ingredients without data. Save explicitly on your device, export JSON for a backup, and import it in another browser. Source values are saved with the recipe, so future data updates do not silently change it. For a branded food, use optional USDA search or enter a label's verified values per 100 g. This is an estimate for meal planning, not medical advice or a regulatory nutrition label.
<!-- /coolcode:guide -->

## Features

- All 5,993 CNF 2026 foods; bilingual token search, arbitrary queries and food-group filters.
- Real edible portion weights; grams, kilograms, ounces and pounds. Volume is available only through a food-specific mass conversion supplied by CNF.
- Eleven nutrients: energy, protein, carbohydrate, fat, saturated fat, fibre, total sugars, sodium, potassium, calcium and iron.
- Whole recipe, per serving and per 100 g, with optional measured finished weight.
- Baseline-versus-current comparison, including changed servings or final weight. Unknown differences are not fabricated.
- Manual foods with any known per-100-g label values; blank nutrients remain missing.
- Explicit local saves, JSON import/export, CSV nutrition summary and printing. Up to 100 ingredients per recipe and 100 locally saved recipes; imports are capped at 2 MB.
- Optional live FoodData Central lookup through a protected proxy. Canadian foods, saved recipes and manual food entry remain usable if that lookup is unavailable.

## Data provenance and calculation rules

[Health Canada's CNF page](https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/nutrient-data/canadian-nutrient-file-about-us.html) links the 2026 CSV release and its users' guide/database structure PDFs. The older online search is the 2015 edition; this app uses the 2026 download, not that legacy frontend.

The collector joins `Food_Name`, `CNF_Food_Group`, `Nutrient_Name`, `Nutrient_Amount`, `Measure_Name` and `Measure_Weight_Conversion` by their published codes. It validates selected nutrient units and complete relationships before publishing. Amounts are per 100 g edible food. **CNF 2026 measure conversion values are already grams**; applying the older 2015 factor × 100 convention would be wrong. Only measure type 6 is accepted. Type 3 is refuse and type 9 is yield, neither an edible serving.

The official 2026 release contains one known orphan conversion: food 1728, measure 1116 has a weight but no entry in `Measure_Name`. Its ambiguous portion is omitted and recorded in `status.json`; that food can still be entered by weight. Any additional unexplained orphan fails the refresh. The validated snapshot contains **21,206 labelled edible portions** and 565,409 source nutrient records (of which the eleven displayed nutrients are extracted).

Each ingredient contributes `nutrient_per_100g × edible_grams / 100`. Total recipe values divide by the recipe's servings, or multiply by `100 / final_weight_g` for finished-dish density. Without a finished weight, per-100-g uses the sum of ingredient weights and explicitly says so. No cooking retention, refuse or yield factor is inferred. Missing values are reported as partial subtotals with the missing ingredient names, not complete zeros. Raw/cooked foods remain separate choices.

Canadian source: Health Canada, Canadian Nutrient File 2026, adapted under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). Health Canada does not endorse this tool. Food composition represents averages unless a specific brand is named.

### USDA integration and API key location

**Do not add an API key to this repository, Pages, a public variable or `web/config.json`.** The owner sets **`FDC_API_KEY` as a Cloudflare Worker secret** on the existing `coolcode-visitor-api` Worker. In Cloudflare: Workers & Pages → `coolcode-visitor-api` → Settings → Variables and Secrets → Add → Secret. A repository secret is unnecessary for this app's core Canadian catalogue.

The public, nonsecret `api_base` in `web/config.json` is `https://coolcode-visitor-api.jeffdyer.workers.dev`. An empty string disables live USDA lookup while keeping Canadian and manual workflows usable. The app expects:

- `GET /api/recipemath/search?q=QUERY&page=1` → `{ "fetched_at": "ISO timestamp", "data": { "foods": [...], "totalHits": 1, "totalPages": 1 } }`.
- `GET /api/recipemath/food?id=FDC_ID` → `{ "fetched_at": "ISO timestamp", "data": FULL_USDA_FOOD_DETAILS }`.

The gateway holds the key, bounds requests, handles upstream failures and allows the CoolCode origin. USDA searches allow up to ten pages; refine the search for other matches when the source has more results. Recipe contents never go to it. The USDA search query and selected FDC ID do. The browser never contacts USDA with a key. No user-provided proxy or arbitrary remote URL is accepted.

[USDA API guide](https://fdc.nal.usda.gov/api-guide/) documents Food Search and Food Details and the need to keep keys private. [Branded food documentation](https://fdc.nal.usda.gov/GBFPD_Documentation/) distinguishes per-100-g and per-100-mL data. Branded records whose serving unit is not grams are rejected with an explanation; the tool does not assume 1 mL = 1 g. `labelNutrients` is ignored because it uses serving amounts. The adapter accepts Foundation, SR Legacy, Survey (FNDDS) and gram-based Branded records, and only matching nutrient units or explicit g↔mg conversion. Research/unknown data types are rejected. Per-100-g mass nutrient values must fit within 100 g (100,000 mg), and energy within 1,000 kcal; this catches common unit-entry mistakes. Foundation energy prefers Atwater-specific ID 2048, then general ID 2047, then legacy energy ID 1008, without adding them. See [Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/).

USDA data are CC0. Attribution: U.S. Department of Agriculture, Agricultural Research Service, FoodData Central. Each selected food retains its FDC ID, data type, source URL, publication date and retrieval timestamp. Saved recipes retain the exact selected snapshot.

## Refresh, publishing and watchdog

`config/source.json` contains the official ZIP URL, edition, documented food count, minimum valid catalogue size, download limit and shard count. To adopt a later CNF release, update these settings, review the new relational schema and units, update the known-orphan handling if necessary, then run the full checks. Do not relabel old data as a new edition.

```sh
python3 scripts/refresh.py
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
CHROME_PATH=/usr/bin/google-chrome python3 tests/browser_smoke.py
```

`refresh.py --source-file PATH_TO_OFFICIAL_ZIP` validates a previously downloaded release reproducibly. The collector downloads at most 60 MB, validates ZIP shape, joins, counts, units, numeric values and relationships before replacing any snapshot files. Download or validation failures leave the prior snapshot intact and fail CI. The offline builder validates the complete hash manifest and rejects mismatched files while preserving its prior output.

`.github/workflows/pages.yml` runs on main push, PR, manual dispatch and **monthly at 12:23 UTC on day 1** (`23 12 1 * *`). Only schedule/manual runs fetch CNF; ordinary builds are offline. A complete refresh, all tests and browser checks must succeed before the source commit and Pages upload. Failed refreshes therefore preserve the last deployment. PRs never deploy. Only `dist/` is deployed, under the `/recipemath/` project path.

A separate `.github/workflows/schedule-guard.yml` renews the source workflow and itself, preserving intentionally disabled workflows. It needs `actions: write`; refresh commits need `contents: write`; Pages needs `pages: write` and `id-token: write`. The repository's Pages source must be **GitHub Actions**.

The external watchdog should register `jsdyer/recipemath`, `.github/workflows/pages.yml`, `.github/workflows/schedule-guard.yml` and the following probe:

- `https://coolcode.ca/recipemath/data/status.json` returns HTTP 200 JSON.
- `count` is at least 5,000; `checked_at` is a successful source check timestamp. Alert after **45 days**, allowing for the monthly schedule.
- Verify page, `data/index.json`, one `foods-N.json` shard and `config.json` return actual files, not an HTML error page.
- `checked_at` means the pinned CNF release was downloaded and validated; it is not a claim that Health Canada published new data that day. `edition` records the source release.

The search index (~1.2 MB) loads once; ten nutrient shards (<0.5 MB each) are fetched on demand. `status.json` (~1.5 KB) gives source SHA-256, per-file hashes, counts, the orphan exception and check time. A complete catalogue is shipped so the app does not depend on a live third-party API.

## Development and tests

Python 3.12+ and Node 24; no runtime package installation is required for the static app. The browser test requires the pinned Playwright Python client in `tests/browser-requirements.txt` and Google Chrome. CI uses the installed `/usr/bin/google-chrome` on Ubuntu 24.04, avoiding a separate browser download.

```sh
python3 -m pip install -r tests/browser-requirements.txt
python3 -m http.server 8000 --directory dist
```

Tests cover CNF gram conventions and edible-only portions; missing nutrients; recipe and serving calculations; final weight; real catalogue search and every food profile; snapshot import; USDA unit/basis validation and energy selection; failed collector/build preservation; subpath loading; browser save/export/import, swaps and invalid input; mocked live USDA lookup and outages; and mobile layout. Browser artifacts are uploaded by CI for review.

Recipes are stored under `coolcode:recipemath:recipes:v1` only after Save. Clearing local storage removes them; JSON exports are the backup. Inputs and imported names use DOM text, never HTML. Font files may be requested from Google Fonts and the site's common visit counter may record a visit; neither includes recipe contents.
