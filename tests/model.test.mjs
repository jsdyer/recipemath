import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  NUTRIENTS,
  numeric,
  units,
  ingredientGrams,
  validateFood,
  validateRecipe,
  calculate,
  scaled,
  comparison,
  searchFoods,
  fromFDC,
  csvSummary,
} from "../web/model.mjs";
const food = (nutrients = { energy: 100, protein: 10, sodium: 20 }) => ({
  id: "test:1",
  name: "Test food, raw",
  source: "Test fixture",
  nutrients,
  portions: [{ label: "1 cup", grams: 250 }],
});
const recipe = (f = food()) => ({
  schema_version: 1,
  name: "Test",
  servings: 4,
  final_weight_g: null,
  ingredients: [{ food: f, amount: 200, unit: "g" }],
});
test("weighted recipe and servings retain units", () => {
  const r = calculate(recipe());
  assert.equal(r.nutrients.energy.value, 200);
  assert.equal(r.nutrients.sodium.value, 40);
  assert.equal(scaled(r, "serving").protein.value, 5);
});
test("2026 portion weights are grams, never old factors multiplied by 100", () => {
  const row = { food: food(), amount: 2, unit: "portion:0" };
  assert.equal(ingredientGrams(row), 500);
  assert.equal(
    ingredientGrams({ ...row, unit: "oz", amount: 1 }),
    28.349523125,
  );
});
test("missing is partial and does not become a complete zero", () => {
  const r = recipe(food({ energy: 0 }));
  r.ingredients.push({ food: food({ protein: 4 }), amount: 50, unit: "g" });
  const t = calculate(r);
  assert.equal(t.nutrients.energy.value, 0);
  assert.equal(t.nutrients.energy.complete, false);
  assert.equal(t.nutrients.protein.value, 2);
  assert.equal(t.nutrients.protein.missing.length, 1);
  assert.equal(t.nutrients.fibre.complete, false);
});
test("finished weight changes density only, not recipe totals or servings", () => {
  const r = recipe();
  r.final_weight_g = 100;
  const t = calculate(r);
  assert.equal(t.nutrients.energy.value, 200);
  assert.equal(scaled(t, "serving").energy.value, 50);
  assert.equal(scaled(t, "100g").energy.value, 200);
  assert.equal(t.inputWeight, 200);
});
test("invalid quantity, unknown portion and servings do not produce totals", () => {
  for (const value of ["", 0, -1, NaN, Infinity, true, null, {}, []])
    assert.throws(() => numeric(value, { positive: true }));
  for (const patch of [
    { servings: 0 },
    { final_weight_g: -10 },
    { ingredients: [{ food: food(), amount: 10, unit: "cup" }] },
  ])
    assert.throws(() => calculate({ ...recipe(), ...patch }));
});
test("saved import preserves snapshots and ignores unrecognized fields", () => {
  const input = recipe();
  input.ingredients[0].food.nutrients.other = 999;
  const normalized = validateRecipe(JSON.parse(JSON.stringify(input)));
  assert.equal(normalized.ingredients[0].food.nutrients.energy, 100);
  assert.equal(normalized.ingredients[0].food.nutrients.other, undefined);
  input.ingredients[0].food.nutrients.energy = 500;
  assert.equal(calculate(normalized).nutrients.energy.value, 200);
});
test("substitution changes and missing comparison is unknown", () => {
  const a = recipe(),
    b = recipe(food({ energy: 50, protein: 20 }));
  assert.equal(comparison(a, b).energy, -25);
  assert.equal(comparison(a, b).protein, 5);
  assert.equal(comparison(a, b).sodium, null);
});
test("full dataset search has French, arbitrary names, group and raw/cooked coverage", () => {
  const index = JSON.parse(
    fs.readFileSync(new URL("../web/data/index.json", import.meta.url)),
  );
  assert.equal(index.foods.length, 5993);
  assert.ok(searchFoods(index.foods, "lentils").length > 5);
  assert.ok(searchFoods(index.foods, "épinard").length > 1);
  assert.ok(searchFoods(index.foods, "banana raw").length > 0);
  assert.equal(searchFoods(index.foods, "banana", "Unrelated group").length, 0);
  const shards = new Map();
  for (const f of index.foods) {
    if (!shards.has(f.shard))
      shards.set(
        f.shard,
        JSON.parse(
          fs.readFileSync(
            new URL(`../web/data/foods-${f.shard}.json`, import.meta.url),
          ),
        ),
      );
    const shard = shards.get(f.shard);
    assert.doesNotThrow(() => validateFood(shard[f.id]));
  }
});
test("USDA normalizes mass units and energy methods without summing or label-serving mixing", () => {
  const input = {
    fdcId: 1,
    description: "Test",
    dataType: "Foundation",
    publicationDate: "2026-01-01",
    foodNutrients: [
      { nutrient: { id: 1008, unitName: "KCAL" }, amount: 100 },
      { nutrient: { id: 2048, unitName: "KCAL" }, amount: 95 },
      { nutrient: { id: 2047, unitName: "KCAL" }, amount: 110 },
      { nutrient: { id: 1093, unitName: "g" }, amount: 0.1 },
      { nutrient: { id: 1003, unitName: "mg" }, amount: 2000 },
      { nutrient: { id: 1089, unitName: "IU" }, amount: 40 },
    ],
    labelNutrients: { calories: { value: 900 } },
    foodPortions: [{ portionDescription: "1 cup", gramWeight: 250 }],
  };
  const f = fromFDC(input, "2026-11-25");
  assert.equal(f.nutrients.energy, 95);
  assert.equal(f.nutrients.sodium, 100);
  assert.equal(f.nutrients.protein, 2);
  assert.equal(f.nutrients.iron, undefined);
  assert.equal(f.portions[0].grams, 250);
  assert.equal(f.data_type, "Foundation");
  assert.equal(f.source_checked, "2026-11-25");
});
test("branded millilitres and unspecified serving basis are rejected, never assumed grams", () => {
  for (const unit of ["ml", ""])
    assert.throws(
      () =>
        fromFDC(
          {
            fdcId: 1,
            description: "drink",
            dataType: "Branded",
            servingSizeUnit: unit,
            foodNutrients: [],
          },
          "",
        ),
      /millilitres/,
    );
  const f = fromFDC(
    {
      fdcId: 2,
      description: "bar",
      dataType: "Branded",
      servingSizeUnit: "g",
      servingSize: 35,
      foodNutrients: [],
    },
    "2026-11-25",
  );
  assert.equal(f.portions[0].grams, 35);
});
test("import text is data, dangerous source URL rejected, csv formulas neutralized", () => {
  const r = recipe();
  r.name = '=HYPERLINK("evil")';
  r.ingredients[0].food.name = "<img src=x onerror=alert(1)>";
  assert.equal(
    validateRecipe(r).ingredients[0].food.name,
    r.ingredients[0].food.name,
  );
  assert.match(csvSummary(r), /'=HYPERLINK/);
  r.ingredients[0].food.source_url = "javascript:alert(1)";
  assert.throws(() => validateRecipe(r));
});

test("per-100g nutrient validation catches unit mistakes in manual/imported foods", () => {
  assert.throws(() => validateFood(food({ protein: 500 })), /Protein must be/);
  assert.throws(() => validateFood(food({ energy: 5000 })), /Energy must be/);
  assert.doesNotThrow(() => validateFood(food({ sodium: 38758, fat: 100 })));
});
test("USDA unsupported research or unknown data types fail visibly", () => {
  assert.throws(
    () =>
      fromFDC(
        {
          fdcId: 1,
          description: "Study sample",
          dataType: "Experimental",
          foodNutrients: [],
        },
        "2026-11-25",
      ),
    /data type/,
  );
});
test("CSV neutralizes a formula after whitespace", () => {
  const r = recipe();
  r.name = "\t=HYPERLINK(1)";
  assert.match(csvSummary(r), /'\t=HYPERLINK/);
});
