export const NUTRIENTS = [
  ["energy", "Energy", "kcal"],
  ["protein", "Protein", "g"],
  ["carbs", "Carbohydrate", "g"],
  ["fat", "Fat", "g"],
  ["saturated", "Saturated fat", "g"],
  ["fibre", "Fibre", "g"],
  ["sugars", "Total sugars", "g"],
  ["sodium", "Sodium", "mg"],
  ["potassium", "Potassium", "mg"],
  ["calcium", "Calcium", "mg"],
  ["iron", "Iron", "mg"],
];
const keys = new Set(NUTRIENTS.map((x) => x[0]));
const text = (v, max = 500) => {
  if (typeof v !== "string" || v.length > max)
    throw Error("Invalid text in recipe file.");
  return v;
};
export function numeric(v, { positive = false, max = 1e7 } = {}) {
  if (
    !["number", "string"].includes(typeof v) ||
    v === null ||
    v === undefined ||
    typeof v === "boolean" ||
    (typeof v === "string" && !v.trim())
  )
    throw Error("Enter a number.");
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (positive && n === 0) || n > max)
    throw Error(
      `Enter ${positive ? "a positive" : "a non-negative"} number below ${max.toLocaleString()}.`,
    );
  return n;
}
export function units(food) {
  return [
    { id: "g", label: "grams", grams: 1 },
    { id: "kg", label: "kilograms", grams: 1000 },
    { id: "oz", label: "ounces (weight)", grams: 28.349523125 },
    { id: "lb", label: "pounds (weight)", grams: 453.59237 },
    ...food.portions.map((p, i) => ({
      id: `portion:${i}`,
      label: p.label,
      grams: p.grams,
    })),
  ];
}
export function ingredientGrams(row) {
  const u = units(row.food).find((u) => u.id === row.unit);
  if (!u) throw Error("Choose a supported portion.");
  return numeric(numeric(row.amount, { positive: true, max: 1e6 }) * u.grams, {
    positive: true,
    max: 1e7,
  });
}
export function validateFood(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Missing food details.");
  const food = {
    id: text(input.id, 100),
    name: text(input.name),
    source: text(input.source, 120),
    source_url: text(input.source_url || "", 1000),
    source_checked: text(input.source_checked || "", 50),
    updated: text(input.updated || "", 50),
    data_type: text(input.data_type || "", 100),
    nutrients: {},
    portions: [],
  };
  if (!food.name.trim() || !food.id || !food.source)
    throw Error("Missing food name or source.");
  if (food.source_url && !/^https:\/\//.test(food.source_url))
    throw Error("Food source URL must use HTTPS.");
  for (const [key, value] of Object.entries(input.nutrients || {}))
    if (
      keys.has(key) &&
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      const [, label, unit] = NUTRIENTS.find((n) => n[0] === key);
      const maximum = unit === "g" ? 100 : unit === "mg" ? 100000 : 1000;
      try {
        food.nutrients[key] = numeric(value, { max: maximum });
      } catch {
        throw Error(
          `${label} must be between 0 and ${maximum.toLocaleString()} ${unit} per 100 g.`,
        );
      }
    }
  if (!Array.isArray(input.portions) || input.portions.length > 100)
    throw Error("Invalid food portions.");
  food.portions = input.portions.map((p) => ({
    label: text(p.label, 300),
    grams: numeric(p.grams, { positive: true, max: 1e6 }),
  }));
  return food;
}
export function emptyRecipe() {
  return {
    schema_version: 1,
    name: "My recipe",
    servings: 4,
    final_weight_g: null,
    ingredients: [],
  };
}
export function validateRecipe(input) {
  if (
    !input ||
    input.schema_version !== 1 ||
    !Array.isArray(input.ingredients) ||
    input.ingredients.length > 100
  )
    throw Error(
      "Use a RecipeMath version 1 file with at most 100 ingredients.",
    );
  const r = {
    schema_version: 1,
    name: text(input.name, 160),
    servings: numeric(input.servings, { positive: true, max: 1000 }),
    final_weight_g:
      input.final_weight_g == null || input.final_weight_g === ""
        ? null
        : numeric(input.final_weight_g, { positive: true, max: 1e7 }),
    ingredients: [],
  };
  r.ingredients = input.ingredients.map((v, i) => ({
    id: `row-${i}`,
    food: validateFood(v.food),
    amount: numeric(v.amount, { positive: true, max: 1e6 }),
    unit: text(v.unit, 30),
  }));
  r.ingredients.forEach(ingredientGrams);
  return r;
}
export function calculate(input) {
  const r = validateRecipe(input);
  const weight = r.ingredients.reduce((s, row) => s + ingredientGrams(row), 0);
  const nutrients = Object.fromEntries(
    NUTRIENTS.map(([key]) => [key, { value: 0, missing: [], complete: true }]),
  );
  for (const row of r.ingredients)
    for (const [key] of NUTRIENTS) {
      const n = nutrients[key];
      if (row.food.nutrients[key] === undefined) {
        n.complete = false;
        n.missing.push(row.food.name);
      } else n.value += (row.food.nutrients[key] * ingredientGrams(row)) / 100;
    }
  return {
    nutrients,
    inputWeight: weight,
    outputWeight: r.final_weight_g ?? weight,
    servings: r.servings,
    count: r.ingredients.length,
  };
}
export function scaled(result, mode) {
  const factor =
    mode === "serving"
      ? 1 / result.servings
      : mode === "100g"
        ? result.outputWeight > 0
          ? 100 / result.outputWeight
          : 0
        : 1;
  return Object.fromEntries(
    Object.entries(result.nutrients).map(([k, n]) => [
      k,
      { ...n, value: n.value * factor },
    ]),
  );
}
export function comparison(before, after, mode = "serving") {
  const a = scaled(calculate(before), mode),
    b = scaled(calculate(after), mode);
  return Object.fromEntries(
    NUTRIENTS.map(([key]) => [
      key,
      a[key].complete && b[key].complete ? b[key].value - a[key].value : null,
    ]),
  );
}
export function normalizeQuery(q) {
  return q
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
export function searchFoods(foods, q, group = "") {
  const tokens = normalizeQuery(q).split(/\s+/).filter(Boolean);
  return foods.filter(
    (f) =>
      (!group || f.group === group) &&
      tokens.every((t) =>
        normalizeQuery([f.name, f.name_fr, f.alternate].join(" ")).includes(t),
      ),
  );
}
export function fromFDC(raw, fetchedAt) {
  if (
    !raw ||
    !Number.isSafeInteger(raw.fdcId) ||
    raw.fdcId <= 0 ||
    typeof raw.description !== "string" ||
    !raw.description.trim() ||
    !Array.isArray(raw.foodNutrients)
  )
    throw Error("USDA returned incomplete food details.");
  if (
    !["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"].includes(
      raw.dataType,
    )
  )
    throw Error(
      "This USDA data type is not supported for recipe calculations. Choose a Foundation, SR Legacy, FNDDS or gram-based branded food.",
    );
  if (
    raw.dataType === "Branded" &&
    String(raw.servingSizeUnit || "").toLowerCase() !== "g"
  )
    throw Error(
      "This branded food uses a volume or unknown nutrient basis. Choose a CNF equivalent or enter verified values per 100 g; millilitres cannot be treated as grams.",
    );
  const nutrientIds = {
    2048: "energy",
    2047: "energy",
    1008: "energy",
    1003: "protein",
    1004: "fat",
    1005: "carbs",
    2000: "sugars",
    1079: "fibre",
    1093: "sodium",
    1092: "potassium",
    1087: "calcium",
    1089: "iron",
    1258: "saturated",
  };
  const nutrientNumbers = {
    208: "energy",
    203: "protein",
    204: "fat",
    205: "carbs",
    269: "sugars",
    291: "fibre",
    307: "sodium",
    306: "potassium",
    301: "calcium",
    303: "iron",
    606: "saturated",
  };
  const nutrients = {};
  let energyPriority = -1;
  for (const entry of raw.foodNutrients) {
    const n = entry.nutrient || {};
    const key = nutrientIds[n.id] || nutrientNumbers[n.number];
    if (!key || entry.amount == null) continue;
    const expected = NUTRIENTS.find((x) => x[0] === key)[2];
    const unit = (n.unitName || "").toLowerCase();
    let value = numeric(entry.amount);
    if (unit === expected) {
    } else if (expected === "mg" && unit === "g") value *= 1000;
    else if (expected === "g" && unit === "mg") value /= 1000;
    else continue;
    if (key === "energy") {
      const priority = n.id === 2048 ? 3 : n.id === 2047 ? 2 : 1;
      if (priority <= energyPriority) continue;
      energyPriority = priority;
    }
    nutrients[key] = value;
  }
  // Accepted USDA foodNutrients amounts are per 100 g; branded volume-basis foods are rejected above. labelNutrients are per serving and never used.
  const portions = (raw.foodPortions || [])
    .filter((p) => Number(p.gramWeight) > 0)
    .map((p) => ({
      label:
        p.portionDescription ||
        `${p.amount || 1} ${p.modifier || p.measureUnit?.name || "portion"}`,
      grams: Number(p.gramWeight),
    }));
  if (raw.servingSizeUnit?.toLowerCase() === "g" && Number(raw.servingSize) > 0)
    portions.push({
      label: raw.householdServingFullText || "label serving",
      grams: Number(raw.servingSize),
    });
  return validateFood({
    id: `fdc:${raw.fdcId}`,
    name: raw.description + (raw.brandOwner ? ` — ${raw.brandOwner}` : ""),
    source: "USDA FoodData Central",
    source_url: `https://fdc.nal.usda.gov/food-details/${raw.fdcId}/nutrients`,
    source_checked: fetchedAt,
    updated: raw.publicationDate || "",
    data_type: raw.dataType || "Unspecified",
    nutrients,
    portions,
  });
}
export function csvSummary(recipe, mode = "serving") {
  const result = scaled(calculate(recipe), mode);
  const safe = (v) =>
    '"' +
    String(v)
      .replace(/^[\s\u0000-\u001f]*[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return [
    ["Recipe", recipe.name],
    ["Basis", mode],
    ["Nutrient", "Value", "Unit", "Coverage"],
    ...NUTRIENTS.map(([k, label, unit]) => [
      label,
      result[k].value.toFixed(3),
      unit,
      result[k].complete
        ? "complete"
        : "partial; missing " + result[k].missing.join("; "),
    ]),
  ]
    .map((row) => row.map(safe).join(","))
    .join("\r\n");
}
