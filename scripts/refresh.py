#!/usr/bin/env python3
"""Validate the complete CNF 2026 source before replacing the published snapshot."""
import argparse
import csv
from datetime import datetime, timezone
from hashlib import sha256
import io
import json
import math
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NUTRIENTS = [
    ('energy', '208', 'kilocalorie'), ('protein', '203', 'Gram'),
    ('fat', '204', 'Gram'), ('carbs', '205', 'Gram'), ('sugars', '269', 'Gram'),
    ('fibre', '291', 'Gram'), ('sodium', '307', 'Milligram'),
    ('potassium', '306', 'Milligram'), ('calcium', '301', 'Milligram'),
    ('iron', '303', 'Milligram'), ('saturated', '606', 'Gram'),
]


def encode(data):
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'


def csv_rows(archive, name, required):
    if name not in archive.namelist():
        raise ValueError('Missing source file: ' + name)
    info = archive.getinfo(name)
    if info.file_size > 180_000_000:
        raise ValueError('Source file too large: ' + name)
    with archive.open(name) as source:
        reader = csv.DictReader(io.TextIOWrapper(source, encoding='utf-8-sig', newline=''))
        if not set(required) <= set(reader.fieldnames or []):
            raise ValueError('Unexpected source columns: ' + name)
        yield from reader


def number(value, *, positive=False):
    n = float(value)
    if not math.isfinite(n) or n < 0 or (positive and n == 0):
        raise ValueError('Invalid source numeric value')
    return n


def prepare(raw, config, checked_at):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        if sum(i.file_size for i in z.infolist()) > 300_000_000:
            raise ValueError('Expanded source exceeds safety limit')
        groups = {r['CNF_Food_Group_Code']: r['CNF_Food_Group_Description_EN'] for r in csv_rows(z, 'CNF_Food_Group.csv', ['CNF_Food_Group_Code', 'CNF_Food_Group_Description_EN'])}
        definitions = {r['Nutrient_Code']: r for r in csv_rows(z, 'Nutrient_Name.csv', ['Nutrient_Code', 'Nutrient_Unit'])}
        for key, code, unit in NUTRIENTS:
            if definitions.get(code, {}).get('Nutrient_Unit') != unit:
                raise ValueError('Nutrient unit changed: ' + key)
        foods = {}
        for r in csv_rows(z, 'Food_Name.csv', ['Food_Code', 'Food_Description_EN', 'Food_Description_FR', 'CNF_Food_Group_Code', 'Food_Last_Updated_Date']):
            code = r['Food_Code']
            if not code.isdigit() or code in foods or not r['Food_Description_EN'].strip():
                raise ValueError('Invalid or duplicate food code')
            if r['CNF_Food_Group_Code'] not in groups:
                raise ValueError('Missing food group')
            foods[code] = {'id': 'cnf:' + code, 'name': r['Food_Description_EN'],
                'name_fr': r['Food_Description_FR'], 'alternate': r.get('Alternate_Description_EN', ''),
                'group': groups[r['CNF_Food_Group_Code']], 'updated': r['Food_Last_Updated_Date'],
                'source': 'CNF ' + config['edition'], 'source_url': config['source_page'],
                'source_checked': checked_at, 'nutrients': {}, 'portions': [],
                'note': r.get('Comment_EN', '')}
        if config.get('expected_foods') and len(foods) != config['expected_foods']:
            raise ValueError('Food count differs from the documented release')
        if len(foods) < config['minimum_foods']:
            raise ValueError('Unexpectedly small catalogue; keeping the previous snapshot')
        codes = {code: key for key, code, _ in NUTRIENTS}
        nutrient_count = 0
        for r in csv_rows(z, 'Nutrient_Amount.csv', ['Food_Code', 'Nutrient_Code', 'Nutrient_Amount']):
            if r['Food_Code'] not in foods:
                raise ValueError('Nutrient refers to unknown food')
            nutrient_count += 1
            if r['Nutrient_Code'] in codes:
                key = codes[r['Nutrient_Code']]
                food = foods[r['Food_Code']]
                if key in food['nutrients']:
                    raise ValueError('Duplicate nutrient for a food')
                food['nutrients'][key] = number(r['Nutrient_Amount'])
        measures = {r['Measure_Code']: r['Measure_Description_and_Unit_EN'] for r in csv_rows(z, 'Measure_Name.csv', ['Measure_Code', 'Measure_Description_and_Unit_EN'])}
        portion_count = 0
        omitted_portions = []
        for r in csv_rows(z, 'Measure_Weight_Conversion.csv', ['Food_Code', 'Measure_Type_Code', 'Measure_Code', 'Measure_Weight_Conversion']):
            if r['Food_Code'] not in foods:
                raise ValueError('Portion refers to unknown food')
            # Type 3 is refuse; type 9 is yield. Neither is an edible portion.
            # CNF 2026 values are already grams, unlike 2015 factors.
            if r['Measure_Type_Code'] != '6':
                continue
            if r['Measure_Code'] not in measures:
                # The official 2026 release has one orphan: food 1728, measure 1116.
                # Do not invent its label; gram weights remain available for this food.
                if (r['Food_Code'], r['Measure_Code']) != ('1728', '1116'):
                    raise ValueError('Unknown portion label')
                omitted_portions.append({'food_code': r['Food_Code'], 'measure_code': r['Measure_Code'], 'reason': 'Missing measure name in official CNF 2026 release'})
                continue
            grams = number(r['Measure_Weight_Conversion'], positive=True)
            foods[r['Food_Code']]['portions'].append({'id': r['Measure_Code'], 'label': measures[r['Measure_Code']], 'grams': grams})
            portion_count += 1
    if any('energy' not in food['nutrients'] for food in foods.values()):
        raise ValueError('Catalogue has food without energy')
    buckets = {str(i): {} for i in range(config['shards'])}
    index = []
    for code, food in sorted(foods.items(), key=lambda row: int(row[0])):
        bucket = str(int(code) % config['shards'])
        buckets[bucket][food['id']] = food
        index.append({'id': food['id'], 'name': food['name'], 'name_fr': food['name_fr'],
                      'alternate': food['alternate'], 'group': food['group'], 'shard': int(bucket)})
    files = {f'foods-{bucket}.json': encode(data) for bucket, data in buckets.items()}
    files['index.json'] = encode({'schema_version': 1, 'edition': config['edition'], 'checked_at': checked_at,
        'food_count': len(index), 'groups': sorted(groups.values()), 'foods': index})
    files['status.json'] = encode({'schema_version': 1, 'edition': config['edition'], 'checked_at': checked_at,
        'count': len(index), 'nutrient_records': nutrient_count, 'portion_count': portion_count,
        'omitted_portions': omitted_portions, 'source_url': config['url'], 'source_sha256': sha256(raw).hexdigest(),
        'files': {name: sha256(content.encode()).hexdigest() for name, content in files.items()}})
    return files


def refresh(root=ROOT, *, source_file=None):
    config = json.loads((root / 'config/source.json').read_text())
    if source_file:
        raw = Path(source_file).read_bytes()
    else:
        request = Request(config['url'], headers={'User-Agent': 'RecipeMath/1.0 (+https://coolcode.ca/recipemath/)'})
        with urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise ValueError('Source did not return HTTP 200')
            raw = response.read(config['maximum_download_bytes'] + 1)
    if len(raw) > config['maximum_download_bytes']:
        raise ValueError('Source download exceeds limit')
    checked = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    files = prepare(raw, config, checked)
    destination = root / 'web/data'
    with tempfile.TemporaryDirectory(dir=root, prefix='.cnf-') as tmp:
        stage = Path(tmp)
        for name, content in files.items():
            (stage / name).write_text(content, encoding='utf-8')
        destination.mkdir(parents=True, exist_ok=True)
        for name in files:
            (stage / name).replace(destination / name)
        for old in destination.glob('foods-*.json'):
            if old.name not in files:
                old.unlink()
    print(f'Validated CNF {config["edition"]}: {json.loads(files["status.json"])["count"]} foods at {checked}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-file', help='Use a previously downloaded official ZIP for reproducible validation')
    args = parser.parse_args()
    refresh(source_file=args.source_file)
