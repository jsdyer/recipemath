import {
  NUTRIENTS,
  numeric,
  units,
  ingredientGrams,
  validateFood,
  emptyRecipe,
  validateRecipe,
  calculate,
  scaled,
  comparison,
  searchFoods,
  fromFDC,
  csvSummary,
} from "./model.mjs";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const node = (tag, txt, cls) => {
  const n = document.createElement(tag);
  if (txt !== undefined) n.textContent = txt;
  if (cls) n.className = cls;
  return n;
};
const fmt = (n) =>
  new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: Math.abs(n) < 10 ? 1 : 0,
  }).format(n);
const date = (s) => (s ? String(s).slice(0, 10) : "not supplied");
const key = "coolcode:recipemath:recipes:v1";
let recipe = emptyRecipe(),
  baseline = null,
  basis = "serving",
  foods = [],
  matches = [],
  shown = 40,
  selected = null,
  sourceStatus = null,
  config = {},
  searchGeneration = 0,
  detailGeneration = 0,
  fdcPage = 1,
  fdcPages = 0,
  loadedId = null;
const shards = new Map();
let saved = [];
function notice(message, error = false) {
  const n = $("#notice");
  n.textContent = message;
  n.hidden = false;
  n.classList.toggle("error", error);
}
function hideNotice() {
  $("#notice").hidden = true;
}
function setView(name) {
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  $$("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
    if (b.dataset.view === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (name === "compare") renderComparison();
  if (name === "saved") renderSaved();
}
$$("[data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$$("[data-view-link]").forEach(
  (b) =>
    (b.onclick = (e) => {
      e.preventDefault();
      setView(b.dataset.viewLink);
    }),
);
function readSettings() {
  recipe.name = $("#recipe-name").value;
  recipe.servings = $("#servings").value;
  recipe.final_weight_g = $("#final-weight").value || null;
}
function syncSettings() {
  $("#recipe-name").value = recipe.name;
  $("#servings").value = recipe.servings;
  $("#final-weight").value = recipe.final_weight_g ?? "";
}
function currentValid() {
  readSettings();
  return validateRecipe(recipe);
}
function validNonempty() {
  const r = currentValid();
  if (!r.ingredients.length) throw Error("Add at least one ingredient first.");
  return r;
}
function renderNutrition() {
  readSettings();
  const out = $("#nutrition-output");
  out.replaceChildren();
  const error = $("#recipe-error");
  error.hidden = true;
  try {
    const result = calculate(recipe);
    $("#weight-summary").textContent = result.count
      ? `${result.count} ingredient${result.count === 1 ? "" : "s"} · ${fmt(result.inputWeight)} g ingredient weight`
      : "Start by adding an ingredient.";
    if (!result.count) {
      out.append(
        node(
          "div",
          "Add ingredients to see your recipe’s nutrition.",
          "empty-state",
        ),
      );
      return;
    }
    const totals = scaled(result, basis);
    const grid = node("div", undefined, "macro-grid");
    for (const key of ["energy", "protein", "carbs", "fat"]) {
      const n = totals[key],
        definition = NUTRIENTS.find((v) => v[0] === key),
        card = node("div", undefined, "macro");
      card.append(
        node("span", definition[1]),
        node("strong", fmt(n.value)),
        node("em", definition[2]),
      );
      if (!n.complete)
        card.append(node("small", "Partial subtotal", "partial"));
      grid.append(card);
    }
    out.append(grid);
    const table = node("table", undefined, "nutrient-table");
    const head = node("tr");
    head.append(
      node("th", "Nutrient"),
      node(
        "th",
        basis === "serving"
          ? `Per serving · 1/${result.servings}`
          : basis === "100g"
            ? "Per 100 g"
            : "Whole recipe",
      ),
    );
    table.append(head);
    for (const [key, label, unit] of NUTRIENTS) {
      const n = totals[key],
        row = node("tr"),
        name = node("td", label),
        value = node("td", `${fmt(n.value)} ${unit}`);
      if (!n.complete) {
        name.append(
          node(
            "span",
            `Missing: ${[...new Set(n.missing)].join("; ")}`,
            "missing",
          ),
        );
        value.append(node("div", "Partial subtotal", "partial"));
      }
      row.append(name, value);
      table.append(row);
    }
    out.append(table);
    $("#weight-note").textContent =
      `Per 100 g uses ${fmt(result.outputWeight)} g ${recipe.final_weight_g ? "finished dish weight" : "combined ingredient weight (no finished weight entered)"}. Cooking can change nutrients; this calculation does not model nutrient loss or retention.`;
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    out.append(
      node(
        "p",
        "Correct the highlighted recipe inputs to calculate. Previous totals are hidden.",
        "error",
      ),
    );
    $("#weight-summary").textContent = "Check recipe inputs.";
  }
}
function renderIngredients() {
  const host = $("#ingredients");
  host.replaceChildren();
  if (!recipe.ingredients.length) {
    const empty = node("div", undefined, "empty-state");
    empty.append(
      node("b", "＋"),
      node("span", "Find a food on the left and add the amount you use."),
    );
    host.append(empty);
  }
  recipe.ingredients.forEach((row, index) => {
    const wrap = node("div", undefined, "ingredient");
    const title = node("div", row.food.name, "ingredient-title");
    title.append(
      node(
        "small",
        `${row.food.source}${row.food.data_type ? " · " + row.food.data_type : ""} · values per 100 g`,
      ),
    );
    const amount = node("input");
    Object.assign(amount, {
      type: "number",
      value: row.amount,
      min: "0.0001",
      max: "1000000",
      step: "any",
    });
    amount.setAttribute("aria-label", `Quantity of ${row.food.name}`);
    const unit = node("select");
    unit.setAttribute("aria-label", `Unit for ${row.food.name}`);
    units(row.food).forEach((u) => {
      const o = node("option", u.label);
      o.value = u.id;
      unit.append(o);
    });
    unit.value = row.unit;
    amount.oninput = () => {
      row.amount = amount.value;
      renderNutrition();
    };
    unit.onchange = () => {
      row.unit = unit.value;
      renderNutrition();
    };
    const remove = node("button", "×", "quiet remove");
    remove.setAttribute("aria-label", `Remove ${row.food.name}`);
    remove.onclick = () => {
      recipe.ingredients.splice(index, 1);
      renderIngredients();
      renderNutrition();
    };
    wrap.append(title, amount, unit, remove);
    host.append(wrap);
  });
}
$$("[data-basis]").forEach(
  (b) =>
    (b.onclick = () => {
      basis = b.dataset.basis;
      $$("[data-basis]").forEach((x) => x.classList.toggle("active", x === b));
      renderNutrition();
      renderComparison();
    }),
);
["recipe-name", "servings", "final-weight"].forEach((id) =>
  $("#" + id).addEventListener("input", renderNutrition),
);
function selectFood(food) {
  selected = validateFood(food);
  const host = $("#food-detail");
  host.hidden = false;
  host.replaceChildren();
  host.append(
    node("h3", selected.name),
    node(
      "p",
      `${selected.source}${selected.data_type ? " · " + selected.data_type : ""} · source date ${date(selected.updated)} · retrieved ${date(selected.source_checked)} · ${selected.id}`,
      "muted",
    ),
  );
  if (selected.source_url) {
    const link = node("a", "View original food source ↗");
    link.href = selected.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    host.append(link);
  }
  const preview = ["energy", "protein", "fibre"]
    .map((k) => {
      const d = NUTRIENTS.find((x) => x[0] === k);
      return `${d[1]}: ${selected.nutrients[k] === undefined ? "unknown" : fmt(selected.nutrients[k]) + " " + d[2]}`;
    })
    .join(" · ");
  host.append(node("p", preview + " per 100 g"));
  const fields = node("div", undefined, "detail-fields"),
    amountLabel = node("label", "Amount"),
    amount = node("input");
  Object.assign(amount, {
    id: "add-amount",
    type: "number",
    min: ".0001",
    step: "any",
    value: "100",
  });
  amountLabel.append(amount);
  const unitLabel = node("label", "Weight or portion"),
    unit = node("select");
  unit.id = "add-unit";
  units(selected).forEach((u) => {
    const o = node(
      "option",
      u.label + (u.id.startsWith("portion") ? ` · ${fmt(u.grams)} g` : ""),
    );
    o.value = u.id;
    unit.append(o);
  });
  unit.onchange = () => {
    amount.value = unit.value === "g" ? "100" : "1";
  };
  unitLabel.append(unit);
  fields.append(amountLabel, unitLabel);
  const add = node("button", "Add ingredient", "primary");
  add.id = "add-ingredient";
  add.onclick = () => {
    try {
      if (recipe.ingredients.length >= 100)
        throw Error("A recipe supports up to 100 ingredients.");
      const row = {
        id: crypto.randomUUID(),
        food: structuredClone(selected),
        amount: numeric(amount.value, { positive: true, max: 1e6 }),
        unit: unit.value,
      };
      ingredientGrams(row);
      recipe.ingredients.push(row);
      renderIngredients();
      renderNutrition();
      notice(`Added ${selected.name}.`);
    } catch (e) {
      notice(e.message, true);
    }
  };
  host.append(fields, add);
}
async function getJSON(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    credentials: "omit",
  });
  if (!response.ok)
    throw Error(
      `Source request failed (${response.status}). Try again shortly.`,
    );
  return response.json();
}
function renderResults() {
  const host = $("#search-results");
  host.replaceChildren();
  matches.slice(0, shown).forEach((food) => {
    const b = node("button", food.name || food.description, "food-result");
    b.append(
      node(
        "small",
        food.group ||
          [food.dataType, food.brandOwner || food.brandName]
            .filter(Boolean)
            .join(" · "),
      ),
    );
    b.onclick = async () => {
      const generation = ++detailGeneration;
      b.disabled = true;
      try {
        let full;
        if ($("#catalogue").value === "cnf") {
          if (!shards.has(food.shard)) {
            const data = await getJSON(`data/foods-${food.shard}.json`);
            shards.set(food.shard, data);
          }
          full = shards.get(food.shard)[food.id];
          if (!full) throw Error("Food details missing from this snapshot.");
        } else {
          const response = await getJSON(
            `${config.api_base}/api/recipemath/food?id=${food.fdcId}`,
          );
          full = fromFDC(response.data, response.fetched_at);
        }
        if (generation === detailGeneration) {
          selectFood(full);
          $$(".food-result").forEach((x) => x.classList.remove("selected"));
          b.classList.add("selected");
        }
      } catch (e) {
        notice(e.message, true);
      } finally {
        b.disabled = false;
      }
    };
    host.append(b);
  });
  $("#more-results").hidden =
    shown >= matches.length &&
    ($("#catalogue").value !== "fdc" || fdcPage >= fdcPages);
  $("#more-results").textContent =
    shown < matches.length ? "Show more foods" : "Load next USDA page";
}
async function search({ next = false } = {}) {
  const generation = ++searchGeneration;
  const q = $("#search").value.trim();
  detailGeneration++;
  $("#find").disabled = false;
  $("#more-results").disabled = false;
  if (!next) {
    shown = 40;
    fdcPage = 1;
    fdcPages = 0;
  }
  if ($("#catalogue").value === "cnf") {
    matches = searchFoods(foods, q, $("#group").value);
    $("#search-status").textContent =
      `${matches.length.toLocaleString()} matching foods · showing ${Math.min(shown, matches.length)}`;
    renderResults();
    return;
  }
  if (q.length < 2) {
    matches = [];
    renderResults();
    $("#search-status").textContent =
      "Enter at least two characters for a USDA search.";
    return;
  }
  $("#search-status").textContent = "Searching USDA…";
  $("#find").disabled = true;
  $("#more-results").disabled = true;
  try {
    if (!config.api_base)
      throw Error(
        "USDA lookup is unavailable. Use the Canadian catalogue or enter a label.",
      );
    const response = await getJSON(
      `${config.api_base}/api/recipemath/search?q=${encodeURIComponent(q)}&page=${fdcPage}`,
    );
    if (generation !== searchGeneration) return;
    const payload = response.data;
    if (!Array.isArray(payload?.foods))
      throw Error("USDA returned an unexpected response.");
    matches = next ? matches.concat(payload.foods) : payload.foods;
    fdcPages = Math.min(Number(payload.totalPages) || 1, 10);
    shown = matches.length;
    $("#search-status").textContent =
      `${Number(payload.totalHits || matches.length).toLocaleString()} USDA matches · page ${fdcPage} · retrieved ${date(response.fetched_at)}${Number(payload.totalPages) > 10 ? " · first 10 pages available; narrow your search for other foods" : ""}`;
    renderResults();
  } catch (e) {
    if (generation === searchGeneration) {
      matches = [];
      fdcPages = 0;
      renderResults();
      $("#search-status").textContent =
        e.message + " The Canadian catalogue remains available.";
    }
  } finally {
    if (generation === searchGeneration) {
      $("#find").disabled = false;
      $("#more-results").disabled = false;
    }
  }
}
$("#find").onclick = () => search();
$("#search").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    search();
  }
};
let debounce;
$("#search").oninput = () => {
  if ($("#catalogue").value === "cnf") {
    clearTimeout(debounce);
    debounce = setTimeout(search, 180);
  }
};
$("#group").onchange = () => search();
$("#catalogue").onchange = () => {
  $("#group-label").hidden = $("#catalogue").value === "fdc";
  $("#food-detail").hidden = true;
  $("#find").disabled = false;
  search();
};
$("#more-results").onclick = () => {
  if (shown < matches.length) {
    shown += 40;
    renderResults();
    $("#search-status").textContent =
      `${matches.length.toLocaleString()} matching foods · showing ${Math.min(shown, matches.length)}`;
  } else {
    fdcPage++;
    search({ next: true });
  }
};
for (const [key, label, unit] of NUTRIENTS) {
  const l = node("label", `${label} (${unit})`),
    i = node("input");
  Object.assign(i, {
    type: "number",
    min: "0",
    step: "any",
    id: `manual-${key}`,
    placeholder: "Unknown",
  });
  l.append(i);
  $("#manual-nutrients").append(l);
}
$("#manual-form").onsubmit = (e) => {
  e.preventDefault();
  try {
    const nutrients = {};
    for (const [k] of NUTRIENTS) {
      const v = $(`#manual-${k}`).value;
      if (v !== "") nutrients[k] = numeric(v);
    }
    if (!Object.keys(nutrients).length)
      throw Error("Enter at least one known nutrient value per 100 g.");
    selectFood({
      id: "manual:" + crypto.randomUUID(),
      name: $("#manual-name").value.trim(),
      source: "User-entered label",
      source_checked: new Date().toISOString(),
      updated: new Date().toISOString().slice(0, 10),
      nutrients,
      portions: [],
    });
    notice("Manual food ready. Choose its amount and add it to the recipe.");
  } catch (e) {
    notice(e.message, true);
  }
};
function loadSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(parsed) || parsed.length > 100)
      throw Error("Invalid saved recipes.");
    saved = parsed.map((item) => ({
      id: String(item.id),
      saved_at: String(item.saved_at),
      recipe: validateRecipe(item.recipe),
    }));
  } catch (e) {
    saved = [];
    notice(
      "Saved recipes could not be read. Existing storage has not been changed. Export backups before clearing browser data.",
      true,
    );
  }
  $("#saved-count").textContent = saved.length;
}
function persist() {
  const serialized = JSON.stringify(saved);
  if (serialized.length > 3500000)
    throw Error(
      "Device storage limit reached. Export and remove an old recipe first.",
    );
  localStorage.setItem(key, serialized);
  $("#saved-count").textContent = saved.length;
}
$("#save-recipe").onclick = () => {
  try {
    const r = validNonempty();
    const existing = saved.findIndex((x) => x.id === loadedId);
    if (existing < 0 && saved.length >= 100)
      throw Error(
        "You can save up to 100 recipes. Export and remove one first.",
      );
    const entry = {
      id: loadedId || crypto.randomUUID(),
      saved_at: new Date().toISOString(),
      recipe: r,
    };
    const before = structuredClone(saved);
    if (existing >= 0) saved[existing] = entry;
    else saved.push(entry);
    try {
      persist();
    } catch (e) {
      saved = before;
      throw e;
    }
    loadedId = entry.id;
    notice("Saved on this device. Export a JSON copy for a portable backup.");
  } catch (e) {
    notice(e.message, true);
  }
};
function activate(r, id = null) {
  recipe = validateRecipe(r);
  loadedId = id;
  syncSettings();
  renderIngredients();
  renderNutrition();
  setView("recipe");
}
$("#new-recipe").onclick = () => {
  if (
    recipe.ingredients.length &&
    !confirm("Start a new recipe? Unsaved edits will be lost.")
  )
    return;
  activate(emptyRecipe());
  hideNotice();
};
function renderSaved() {
  const list = $("#saved-list");
  list.replaceChildren();
  if (!saved.length) {
    list.append(
      node(
        "p",
        "No saved recipes yet. Build a recipe, then choose Save on this device.",
        "empty-state",
      ),
    );
    return;
  }
  for (const item of saved) {
    const row = node("div", undefined, "saved-item"),
      description = node("div");
    description.append(
      node("strong", item.recipe.name || "Untitled recipe"),
      node(
        "small",
        `${item.recipe.ingredients.length} ingredients · saved ${date(item.saved_at)}`,
      ),
    );
    const actions = node("div"),
      open = node("button", "Open", "secondary"),
      del = node("button", "Delete", "quiet");
    open.onclick = () => {
      if (
        recipe.ingredients.length &&
        !confirm(
          "Open this saved recipe? Unsaved edits in the workspace will be replaced.",
        )
      )
        return;
      activate(item.recipe, item.id);
      notice(
        "Loaded the saved food snapshots. Values are unchanged by newer source releases.",
      );
    };
    del.onclick = () => {
      if (!confirm(`Delete “${item.recipe.name}” from this device?`)) return;
      const previous = saved;
      saved = saved.filter((s) => s.id !== item.id);
      try {
        persist();
        if (loadedId === item.id) loadedId = null;
        renderSaved();
      } catch (e) {
        saved = previous;
        notice(e.message, true);
      }
    };
    actions.append(open, del);
    row.append(description, actions);
    list.append(row);
  }
}
function download(contents, type, extension) {
  const blob = new Blob([contents], { type });
  const a = node("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    (recipe.name || "recipe")
      .replace(/[^a-z0-9 -]/gi, "")
      .trim()
      .slice(0, 70)
      .replaceAll(" ", "-") +
    "." +
    extension;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#export-json").onclick = () => {
  try {
    download(
      JSON.stringify(validNonempty(), null, 2),
      "application/json",
      "json",
    );
  } catch (e) {
    notice(e.message, true);
  }
};
$("#export-csv").onclick = () => {
  try {
    download(
      csvSummary(validNonempty(), basis),
      "text/csv;charset=utf-8",
      "csv",
    );
  } catch (e) {
    notice(e.message, true);
  }
};
$("#print").onclick = () => {
  try {
    validNonempty();
    print();
  } catch (e) {
    notice(e.message, true);
  }
};
$("#import-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2000000)
      throw Error("Choose a recipe file smaller than 2 MB.");
    const r = validateRecipe(JSON.parse(await file.text()));
    if (
      recipe.ingredients.length &&
      !confirm(
        "Import this recipe? Unsaved edits in the workspace will be replaced.",
      )
    )
      return;
    activate(r);
    notice(
      "Imported into the workspace. Choose Save to keep it on this device.",
    );
  } catch (e) {
    notice(`Import failed: ${e.message}`, true);
  } finally {
    e.target.value = "";
  }
};
$("#set-baseline").onclick = () => {
  try {
    baseline = structuredClone(validNonempty());
    renderComparison();
    notice(
      "Baseline captured. Change any ingredient in the workspace, then return here.",
    );
  } catch (e) {
    notice(e.message, true);
  }
};
function renderComparison() {
  const out = $("#comparison");
  out.replaceChildren();
  $("#baseline-label").textContent = baseline
    ? `Baseline: ${baseline.name} · ${baseline.ingredients.length} ingredients · ${baseline.servings} servings`
    : "No baseline yet.";
  if (!baseline) return;
  try {
    const r = validNonempty(),
      old = scaled(calculate(baseline), basis),
      now = scaled(calculate(r), basis),
      diff = comparison(baseline, r, basis);
    out.append(
      node(
        "p",
        `Basis: ${basis === "serving" ? "per serving" : basis === "100g" ? "per 100 g" : "whole recipe"}. Positive means more; negative means less. Neither is automatically better.`,
        "compare-note",
      ),
    );
    const table = node("table", undefined, "compare-table"),
      head = node("tr");
    ["Nutrient", "Baseline", "Current", "Change"].forEach((x) =>
      head.append(node("th", x)),
    );
    table.append(head);
    for (const [k, label, unit] of NUTRIENTS) {
      const row = node("tr");
      row.append(
        node("td", label),
        node(
          "td",
          old[k].complete ? fmt(old[k].value) + " " + unit : "Partial",
        ),
        node(
          "td",
          now[k].complete ? fmt(now[k].value) + " " + unit : "Partial",
        ),
        node(
          "td",
          diff[k] === null
            ? "Unknown"
            : (diff[k] > 0 ? "+" : "") + fmt(diff[k]) + " " + unit,
        ),
      );
      table.append(row);
    }
    out.append(table);
  } catch (e) {
    out.append(node("p", e.message, "error"));
  }
}
async function init() {
  loadSaved();
  syncSettings();
  renderIngredients();
  renderNutrition();
  try {
    const [index, status, cfg] = await Promise.all([
      getJSON("data/index.json"),
      getJSON("data/status.json"),
      getJSON("config.json"),
    ]);
    if (!Array.isArray(index.foods) || index.foods.length !== status.count)
      throw Error("Catalogue files disagree.");
    foods = index.foods;
    sourceStatus = status;
    config = cfg;
    $("#catalogue-count").textContent =
      `${status.count.toLocaleString()} Canadian foods`;
    $("#catalogue-date").textContent =
      `CNF ${status.edition} · checked ${date(status.checked_at)}`;
    $("#source-details").textContent =
      `Edition ${status.edition}. Source successfully checked ${date(status.checked_at)}. ${status.count.toLocaleString()} foods and ${status.portion_count.toLocaleString()} labelled edible portions. Source checks run monthly; an unsuccessful check preserves the previous validated snapshot.`;
    index.groups.forEach((g) => {
      const o = node("option", g);
      o.value = g;
      $("#group").append(o);
    });
    search();
  } catch (e) {
    $("#search-status").textContent =
      "The Canadian catalogue could not load. Reload to try again; manual food entry and your saved recipes still work.";
    $("#catalogue-date").textContent = "Source status unavailable";
    notice(e.message, true);
  }
}
init();
