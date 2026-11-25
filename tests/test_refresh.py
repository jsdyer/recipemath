import csv
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh import prepare, refresh, NUTRIENTS


def fixture(*, portion_type='6', portion_code='1', amount='250', nutrient_unit=None, nutrient_value='100'):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        def add(name, fields, rows):
            s = io.StringIO(); w = csv.DictWriter(s, fieldnames=fields); w.writeheader(); w.writerows(rows); z.writestr(name, s.getvalue())
        add('CNF_Food_Group.csv', ['CNF_Food_Group_Code','CNF_Food_Group_Description_EN'],[{'CNF_Food_Group_Code':'1','CNF_Food_Group_Description_EN':'Test'}])
        add('Nutrient_Name.csv',['Nutrient_Code','Nutrient_Unit'],[{'Nutrient_Code':code,'Nutrient_Unit':nutrient_unit if key=='energy' and nutrient_unit else unit} for key,code,unit in NUTRIENTS])
        add('Food_Name.csv',['Food_Code','Food_Description_EN','Food_Description_FR','CNF_Food_Group_Code','Food_Last_Updated_Date'],[{'Food_Code':'1','Food_Description_EN':'Fixture raw','Food_Description_FR':'Test','CNF_Food_Group_Code':'1','Food_Last_Updated_Date':'2026-01-01'}])
        add('Nutrient_Amount.csv',['Food_Code','Nutrient_Code','Nutrient_Amount'],[{'Food_Code':'1','Nutrient_Code':'208','Nutrient_Amount':nutrient_value}])
        add('Measure_Name.csv',['Measure_Code','Measure_Description_and_Unit_EN'],[{'Measure_Code':'1','Measure_Description_and_Unit_EN':'1 cup'}])
        add('Measure_Weight_Conversion.csv',['Food_Code','Measure_Type_Code','Measure_Code','Measure_Weight_Conversion'],[{'Food_Code':'1','Measure_Type_Code':portion_type,'Measure_Code':portion_code,'Measure_Weight_Conversion':amount}])
    return out.getvalue()


class RefreshTests(unittest.TestCase):
    config={'edition':'2026','minimum_foods':1,'shards':2,'source_page':'https://example.test/source','url':'https://example.test/data.zip'}
    def test_2026_grams_and_missing_nutrients(self):
        files=prepare(fixture(),self.config,'2026-11-25T00:00:00Z')
        food=json.loads(files['foods-1.json'])['cnf:1']
        self.assertEqual(food['portions'][0]['grams'],250)
        self.assertEqual(food['nutrients'],{'energy':100})
        self.assertEqual(json.loads(files['status.json'])['count'],1)
    def test_refuse_and_yield_never_become_edible_portions(self):
        for kind in ['3','9']:
            files=prepare(fixture(portion_type=kind),self.config,'2026-11-25T00:00:00Z')
            self.assertEqual(json.loads(files['foods-1.json'])['cnf:1']['portions'],[])
    def test_unknown_portion_and_unit_changes_fail_closed(self):
        for kwargs in [{'portion_code':'99'},{'nutrient_unit':'kJ'},{'amount':'NaN'},{'nutrient_value':'-2'}]:
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):prepare(fixture(**kwargs),self.config,'2026-11-25T00:00:00Z')
    def test_failed_refresh_preserves_published_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'config').mkdir(); (root/'web/data').mkdir(parents=True)
            (root/'config/source.json').write_text(json.dumps({**self.config,'maximum_download_bytes':1000000}))
            good = root/'web/data/status.json'; good.write_text('previous valid snapshot')
            bad = root/'bad.zip'; bad.write_bytes(b'not a source ZIP')
            with self.assertRaises(zipfile.BadZipFile):refresh(root,source_file=bad)
            self.assertEqual(good.read_text(),'previous valid snapshot')

    def test_truncated_or_tiny_source_rejected(self):
        with self.assertRaises(zipfile.BadZipFile):prepare(b'not a zip',self.config,'2026-11-25T00:00:00Z')
        with self.assertRaises(ValueError):prepare(fixture(),{**self.config,'minimum_foods':2},'2026-11-25T00:00:00Z')

if __name__=='__main__':unittest.main()
