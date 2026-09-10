# Category-Aware Field Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect each feed item's product category automatically and score/recommend its 8 conditional fields (brand/color/size/size_system/gender/age_group/item_group_id/sale_price) against that category's critical/medium/optional priority tier, instead of one flat rule for the whole feed.

**Architecture:** All logic is client-side, added to the single existing file `public/index.html` (no build step, no backend — see spec section 1 "Не входит в объём"). New top-level data (`CATEGORY_LIST`, `CATEGORY_FIELD_TIERS`, `CATEGORY_KEYWORDS`, `CONDITIONAL_FIELDS`) and pure functions (`detectCategory`, `computeCategoryBreakdown`, `buildTieredFieldRecs`) sit next to the existing `FIELDS` array. `renderAnalytics()` calls them to prepend a new "Разбивка по категориям" panel and to replace two flat recommendations (brand, item_group_id) with 8 tiered ones.

**Tech Stack:** Vanilla JS (ES5 style, matches existing file), no dependencies added. Verification uses throwaway `node` scripts (the project has no browser/jsdom test harness for frontend code — confirmed: `test/` only covers the Express backend, and spec section 6 explicitly settled on code-review + manual smoke test for this feature).

## Global Constraints

- Single file to touch: `public/index.html`. No new files, no new npm dependencies.
- Category slugs and field-tier values must match `docs/superpowers/specs/2026-09-10-category-aware-field-priority-design.md` section 2 exactly (sourced from the user's `ratings/matrix` data, not any earlier draft).
- Conditional fields are exactly these 8: `brand`, `color`, `size`, `size_system`, `gender`, `age_group`, `item_group_id`, `sale_price`. Do not touch `material`/`pattern`/`condition`/`product_highlight`/`energy_efficiency_class` — those stay in `FIELDS` for the (out-of-scope) "Заполненность полей" tab but get no category-tier logic.
- Detection keywords exist only for 9 of the 12 categories (spec section 3). `books_media`, `gifts`, `school_creativity` have real tier data but no keywords yet — `detectCategory` must never return those three keys. This is intentional, not a bug to "fix" during this plan.
- Items with `category: null` (no keyword match) are excluded from tiered recommendations and from the per-category breakdown rows — they only appear in the "Категория не определена" bucket.
- Do not modify `renderFields()` / `#tab-fields` ("Заполненность полей" tab) — explicitly out of scope per spec section 1.
- Russian-language UI copy throughout, matching the existing app's tone (see existing recommendation strings for style).

---

### Task 1: Category tier data

**Files:**
- Modify: `public/index.html` (insert after the `FIELDS` array, which ends at the line `];` immediately before `var allItems = [];`)

**Interfaces:**
- Produces: `CATEGORY_LIST` (array of `{key, label}`, 12 entries, canonical display order), `CATEGORY_FIELD_TIERS` (object, 12 keys matching `CATEGORY_LIST`, each value an object with all 8 `CONDITIONAL_FIELDS` keys set to `'critical'|'medium'|'optional'`), `CONDITIONAL_FIELDS` (array of 8 field-key strings). Later tasks read all three by name.

- [ ] **Step 1: Locate the insertion point**

Open `public/index.html` and find this exact block (currently ends around line 1004):

```javascript
  { key:'size_system', label:'Размерная сетка', req:false },
];
var allItems = [];
```

- [ ] **Step 2: Insert the category data between the `FIELDS` array and `var allItems`**

Replace:
```javascript
  { key:'size_system', label:'Размерная сетка', req:false },
];
var allItems = [];
```

With:
```javascript
  { key:'size_system', label:'Размерная сетка', req:false },
];

// ── Категорийная приоритезация (docs/superpowers/specs/2026-09-10-...) ──
var CONDITIONAL_FIELDS = ['brand', 'color', 'size', 'size_system', 'gender', 'age_group', 'item_group_id', 'sale_price'];

var CATEGORY_LIST = [
  { key: 'odezhda',           label: 'Одежда' },
  { key: 'obuv',               label: 'Обувь' },
  { key: 'dom',                 label: 'Товары для дома' },
  { key: 'krasota',            label: 'Красота и здоровье' },
  { key: 'detskie',            label: 'Детские товары' },
  { key: 'elektronika',        label: 'Электроника' },
  { key: 'aksessuary',         label: 'Аксессуары' },
  { key: 'sport',               label: 'Спортивные товары' },
  { key: 'juvelirka',          label: 'Ювелирные изделия' },
  { key: 'books_media',        label: 'Книги, музыка и фильмы' },
  { key: 'gifts',               label: 'Подарки и сувениры' },
  { key: 'school_creativity',  label: 'Школа и творчество' }
];

var CATEGORY_FIELD_TIERS = {
  odezhda:           { brand: 'critical', color: 'medium',   size: 'critical', size_system: 'critical', gender: 'critical', age_group: 'critical', item_group_id: 'critical', sale_price: 'optional' },
  obuv:              { brand: 'critical', color: 'medium',   size: 'critical', size_system: 'critical', gender: 'critical', age_group: 'critical', item_group_id: 'critical', sale_price: 'optional' },
  dom:               { brand: 'critical', color: 'medium',   size: 'medium',   size_system: 'optional', gender: 'optional', age_group: 'optional', item_group_id: 'optional', sale_price: 'optional' },
  krasota:           { brand: 'critical', color: 'medium',   size: 'critical', size_system: 'optional', gender: 'critical', age_group: 'optional', item_group_id: 'critical', sale_price: 'optional' },
  detskie:           { brand: 'critical', color: 'medium',   size: 'medium',   size_system: 'optional', gender: 'medium',   age_group: 'critical', item_group_id: 'optional', sale_price: 'optional' },
  elektronika:       { brand: 'critical', color: 'critical', size: 'optional', size_system: 'optional', gender: 'optional', age_group: 'optional', item_group_id: 'medium',   sale_price: 'optional' },
  aksessuary:        { brand: 'critical', color: 'critical', size: 'medium',   size_system: 'optional', gender: 'critical', age_group: 'optional', item_group_id: 'optional', sale_price: 'optional' },
  sport:             { brand: 'critical', color: 'medium',   size: 'medium',   size_system: 'optional', gender: 'medium',   age_group: 'medium',   item_group_id: 'medium',   sale_price: 'optional' },
  juvelirka:         { brand: 'critical', color: 'medium',   size: 'critical', size_system: 'critical', gender: 'critical', age_group: 'optional', item_group_id: 'critical', sale_price: 'optional' },
  books_media:       { brand: 'medium',   color: 'optional', size: 'optional', size_system: 'optional', gender: 'optional', age_group: 'medium',   item_group_id: 'medium',   sale_price: 'optional' },
  gifts:             { brand: 'medium',   color: 'critical', size: 'medium',   size_system: 'optional', gender: 'medium',   age_group: 'medium',   item_group_id: 'medium',   sale_price: 'optional' },
  school_creativity: { brand: 'medium',   color: 'critical', size: 'medium',   size_system: 'optional', gender: 'optional', age_group: 'critical', item_group_id: 'medium',   sale_price: 'optional' }
};

var allItems = [];
```

- [ ] **Step 3: Verify the data shape with a throwaway node script**

Create `scratch-task1.js` in the repo root (temporary, not committed) with this content:

```javascript
var CONDITIONAL_FIELDS = ['brand', 'color', 'size', 'size_system', 'gender', 'age_group', 'item_group_id', 'sale_price'];
var CATEGORY_LIST = [
  { key: 'odezhda',           label: 'Одежда' },
  { key: 'obuv',               label: 'Обувь' },
  { key: 'dom',                 label: 'Товары для дома' },
  { key: 'krasota',            label: 'Красота и здоровье' },
  { key: 'detskie',            label: 'Детские товары' },
  { key: 'elektronika',        label: 'Электроника' },
  { key: 'aksessuary',         label: 'Аксессуары' },
  { key: 'sport',               label: 'Спортивные товары' },
  { key: 'juvelirka',          label: 'Ювелирные изделия' },
  { key: 'books_media',        label: 'Книги, музыка и фильмы' },
  { key: 'gifts',               label: 'Подарки и сувениры' },
  { key: 'school_creativity',  label: 'Школа и творчество' }
];
var CATEGORY_FIELD_TIERS = {
  odezhda:           { brand: 'critical', color: 'medium',   size: 'critical', size_system: 'critical', gender: 'critical', age_group: 'critical', item_group_id: 'critical', sale_price: 'optional' },
  obuv:              { brand: 'critical', color: 'medium',   size: 'critical', size_system: 'critical', gender: 'critical', age_group: 'critical', item_group_id: 'critical', sale_price: 'optional' },
  dom:               { brand: 'critical', color: 'medium',   size: 'medium',   size_system: 'optional', gender: 'optional', age_group: 'optional', item_group_id: 'optional', sale_price: 'optional' },
  krasota:           { brand: 'critical', color: 'medium',   size: 'critical', size_system: 'optional', gender: 'critical', age_group: 'optional', item_group_id: 'critical', sale_price: 'optional' },
  detskie:           { brand: 'critical', color: 'medium',   size: 'medium',   size_system: 'optional', gender: 'medium',   age_group: 'critical', item_group_id: 'optional', sale_price: 'optional' },
  elektronika:       { brand: 'critical', color: 'critical', size: 'optional', size_system: 'optional', gender: 'optional', age_group: 'optional', item_group_id: 'medium',   sale_price: 'optional' },
  aksessuary:        { brand: 'critical', color: 'critical', size: 'medium',   size_system: 'optional', gender: 'critical', age_group: 'optional', item_group_id: 'optional', sale_price: 'optional' },
  sport:             { brand: 'critical', color: 'medium',   size: 'medium',   size_system: 'optional', gender: 'medium',   age_group: 'medium',   item_group_id: 'medium',   sale_price: 'optional' },
  juvelirka:         { brand: 'critical', color: 'medium',   size: 'critical', size_system: 'critical', gender: 'critical', age_group: 'optional', item_group_id: 'critical', sale_price: 'optional' },
  books_media:       { brand: 'medium',   color: 'optional', size: 'optional', size_system: 'optional', gender: 'optional', age_group: 'medium',   item_group_id: 'medium',   sale_price: 'optional' },
  gifts:             { brand: 'medium',   color: 'critical', size: 'medium',   size_system: 'optional', gender: 'medium',   age_group: 'medium',   item_group_id: 'medium',   sale_price: 'optional' },
  school_creativity: { brand: 'medium',   color: 'critical', size: 'medium',   size_system: 'optional', gender: 'optional', age_group: 'critical', item_group_id: 'medium',   sale_price: 'optional' }
};

var assert = require('assert');
assert.strictEqual(CATEGORY_LIST.length, 12, 'CATEGORY_LIST must have 12 entries');
assert.strictEqual(Object.keys(CATEGORY_FIELD_TIERS).length, 12, 'CATEGORY_FIELD_TIERS must have 12 keys');
var VALID_TIERS = { critical: 1, medium: 1, optional: 1 };
CATEGORY_LIST.forEach(function (c) {
  var tiers = CATEGORY_FIELD_TIERS[c.key];
  assert.ok(tiers, 'missing tiers for ' + c.key);
  assert.strictEqual(Object.keys(tiers).length, 8, c.key + ' must have exactly 8 field tiers');
  CONDITIONAL_FIELDS.forEach(function (f) {
    assert.ok(VALID_TIERS[tiers[f]], c.key + '.' + f + ' has invalid tier: ' + tiers[f]);
  });
});
// Spot checks from the spec
assert.strictEqual(CATEGORY_FIELD_TIERS.odezhda.brand, 'critical');
assert.strictEqual(CATEGORY_FIELD_TIERS.dom.gender, 'optional');
assert.strictEqual(CATEGORY_FIELD_TIERS.elektronika.color, 'critical');
assert.strictEqual(CATEGORY_FIELD_TIERS.obuv.size_system, 'critical');
var booksMediaCritical = CONDITIONAL_FIELDS.filter(function (f) { return CATEGORY_FIELD_TIERS.books_media[f] === 'critical'; });
assert.strictEqual(booksMediaCritical.length, 0, 'books_media should have zero critical fields');
console.log('OK: task 1 data shape verified');
```

Run: `node scratch-task1.js`
Expected output: `OK: task 1 data shape verified`

- [ ] **Step 4: Delete the scratch file**

Run: `rm scratch-task1.js`

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "Add category-field priority tier data"
```

---

### Task 2: Category detection

**Files:**
- Modify: `public/index.html` (insert immediately after the block added in Task 1, still before `var allItems = [];` — or immediately after it, either is fine as long as it's before first use in Task 3+)

**Interfaces:**
- Consumes: `CATEGORY_LIST` (from Task 1), `FIELDS` (existing array, for label lookup).
- Produces: `CATEGORY_KEYWORDS` (array of `{key, keywords}`, 9 entries, detection priority order), `detectCategory(item)` → category key string or `null`, `fieldLabel(key)` → label string (falls back to `key` if not found).

- [ ] **Step 1: Insert the keyword dictionary and detection functions**

Add this immediately after the `var allItems = [];` line added in Task 1 (i.e. right after it, still before `function getField`):

```javascript
var CATEGORY_KEYWORDS = [
  { key: 'detskie', keywords: ['детск', 'для детей', 'малыш', 'младенец', 'новорожденн', 'подгузник', 'коляск', 'автокресл', 'погремушк', 'пелёнк'] },
  { key: 'juvelirka', keywords: ['кольцо', 'кольца', 'серьг', 'цепочк', 'кулон', 'подвеск', 'ювелир', 'брошь', 'запонк', 'ожерель'] },
  { key: 'sport', keywords: ['тренажёр', 'гантел', 'штанг', 'гиря', 'велосипед', 'самокат', 'ролики', 'коврик для йоги', 'скакалк', 'эспандер', 'беговая дорожк', 'наколенник', 'налокотник'] },
  { key: 'aksessuary', keywords: ['сумк', 'рюкзак', 'чехол', 'ремень', 'кошелёк', 'портмоне', 'шарф', 'перчатк', 'шапк', 'очки солнцезащитн', 'зонт'] },
  { key: 'obuv', keywords: ['обувь', 'кроссовк', 'ботинк', 'туфли', 'сапог', 'сандал'] },
  { key: 'elektronika', keywords: ['смартфон', 'телефон', 'ноутбук', 'компьютер', 'планшет', 'наушник', 'умные час', 'смарт-час', 'фитнес-браслет', 'умная колонк', 'телевизор', 'пылесос', 'фен', 'блендер', 'кабель', 'зарядн', 'powerbank', 'повербанк', 'фотоаппарат', 'увлажнитель воздух', 'очиститель воздух'] },
  { key: 'odezhda', keywords: ['одежд', 'футболк', 'рубашк', 'брюки', 'джинс', 'платье', 'юбк', 'куртк', 'пальто', 'свитер', 'толстовк', 'шорты', 'костюм', 'бельё'] },
  { key: 'krasota', keywords: ['крем', 'сыворотк', 'шампунь', 'парфюм', 'дух', 'туалетная вода', 'тушь', 'помад', 'тональн', 'витамин', 'бад', 'космети', 'уход за кож', 'уход за волос'] },
  { key: 'dom', keywords: ['мебель', 'посуд', 'кастрюл', 'сковород', 'постельн', 'полотенц', 'штор', 'светильник', 'лампа', 'ковёр', 'декор для дома', 'кухонн утвар'] }
];

function matchCategoryText(text) {
  if (!text) return null;
  var lower = text.toLowerCase();
  for (var i = 0; i < CATEGORY_KEYWORDS.length; i++) {
    var entry = CATEGORY_KEYWORDS[i];
    for (var j = 0; j < entry.keywords.length; j++) {
      if (lower.indexOf(entry.keywords[j]) !== -1) return entry.key;
    }
  }
  return null;
}

function detectCategory(item) {
  return matchCategoryText(item.product_type) || matchCategoryText(item.title);
}

function fieldLabel(key) {
  for (var i = 0; i < FIELDS.length; i++) { if (FIELDS[i].key === key) return FIELDS[i].label; }
  return key;
}
```

- [ ] **Step 2: Verify detection behavior with a throwaway node script**

Create `scratch-task2.js` in the repo root with this content (includes the exact code from Step 1, standalone):

```javascript
var CATEGORY_KEYWORDS = [
  { key: 'detskie', keywords: ['детск', 'для детей', 'малыш', 'младенец', 'новорожденн', 'подгузник', 'коляск', 'автокресл', 'погремушк', 'пелёнк'] },
  { key: 'juvelirka', keywords: ['кольцо', 'кольца', 'серьг', 'цепочк', 'кулон', 'подвеск', 'ювелир', 'брошь', 'запонк', 'ожерель'] },
  { key: 'sport', keywords: ['тренажёр', 'гантел', 'штанг', 'гиря', 'велосипед', 'самокат', 'ролики', 'коврик для йоги', 'скакалк', 'эспандер', 'беговая дорожк', 'наколенник', 'налокотник'] },
  { key: 'aksessuary', keywords: ['сумк', 'рюкзак', 'чехол', 'ремень', 'кошелёк', 'портмоне', 'шарф', 'перчатк', 'шапк', 'очки солнцезащитн', 'зонт'] },
  { key: 'obuv', keywords: ['обувь', 'кроссовк', 'ботинк', 'туфли', 'сапог', 'сандал'] },
  { key: 'elektronika', keywords: ['смартфон', 'телефон', 'ноутбук', 'компьютер', 'планшет', 'наушник', 'умные час', 'смарт-час', 'фитнес-браслет', 'умная колонк', 'телевизор', 'пылесос', 'фен', 'блендер', 'кабель', 'зарядн', 'powerbank', 'повербанк', 'фотоаппарат', 'увлажнитель воздух', 'очиститель воздух'] },
  { key: 'odezhda', keywords: ['одежд', 'футболк', 'рубашк', 'брюки', 'джинс', 'платье', 'юбк', 'куртк', 'пальто', 'свитер', 'толстовк', 'шорты', 'костюм', 'бельё'] },
  { key: 'krasota', keywords: ['крем', 'сыворотк', 'шампунь', 'парфюм', 'дух', 'туалетная вода', 'тушь', 'помад', 'тональн', 'витамин', 'бад', 'космети', 'уход за кож', 'уход за волос'] },
  { key: 'dom', keywords: ['мебель', 'посуд', 'кастрюл', 'сковород', 'постельн', 'полотенц', 'штор', 'светильник', 'лампа', 'ковёр', 'декор для дома', 'кухонн утвар'] }
];

function matchCategoryText(text) {
  if (!text) return null;
  var lower = text.toLowerCase();
  for (var i = 0; i < CATEGORY_KEYWORDS.length; i++) {
    var entry = CATEGORY_KEYWORDS[i];
    for (var j = 0; j < entry.keywords.length; j++) {
      if (lower.indexOf(entry.keywords[j]) !== -1) return entry.key;
    }
  }
  return null;
}

function detectCategory(item) {
  return matchCategoryText(item.product_type) || matchCategoryText(item.title);
}

var assert = require('assert');
// Basic product_type match
assert.strictEqual(detectCategory({ product_type: 'Одежда > Мужская > Футболки', title: 'Футболка мужская' }), 'odezhda');
// Fallback to title when product_type has no match
assert.strictEqual(detectCategory({ product_type: null, title: 'Фитнес-браслет Xiaomi Mi Band 8' }), 'elektronika');
// The documented conflict: bare "браслет" (no фитнес-/смарт- prefix) must win as jewelry, not electronics
assert.strictEqual(detectCategory({ product_type: null, title: 'Браслет золотой с кулоном' }), 'juvelirka');
// No match anywhere -> null
assert.strictEqual(detectCategory({ product_type: null, title: 'Неопознанный товар XZ-9000' }), null);
// Case-insensitivity
assert.strictEqual(detectCategory({ product_type: null, title: 'КРОССОВКИ NIKE AIR MAX' }), 'obuv');
// books_media/gifts/school_creativity must be unreachable (no keywords defined yet)
var reachable = {};
CATEGORY_KEYWORDS.forEach(function (e) { reachable[e.key] = true; });
assert.ok(!reachable.books_media && !reachable.gifts && !reachable.school_creativity, 'the 3 unconfirmed categories must stay undetectable until keywords are agreed');
console.log('OK: task 2 detection verified');
```

Run: `node scratch-task2.js`
Expected output: `OK: task 2 detection verified`

- [ ] **Step 3: Delete the scratch file**

Run: `rm scratch-task2.js`

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "Add category detection from product_type/title keywords"
```

---

### Task 3: Category breakdown (hoist shared helpers + new panel)

**Files:**
- Modify: `public/index.html` — move `anCard` and `detailTable` out of `renderAnalytics()` to top-level scope, then add `computeCategoryBreakdown` and `renderCategoryBreakdown` next to them.

**Interfaces:**
- Consumes: `detectCategory`, `CATEGORY_LIST`, `CATEGORY_FIELD_TIERS`, `CONDITIONAL_FIELDS` (Tasks 1–2), existing top-level `pct(n, total)` (already defined at the existing line `function pct(n, total) { return total ? Math.round(n / total * 100) : 0; }`).
- Produces: `anCard(title, rows, detailId, detailHtml)` and `detailTable(rows, cols)` now callable from anywhere (previously local to `renderAnalytics`), `computeCategoryBreakdown(items)` → `{ rows: [{key, label, count, criticalFieldCount, criticalPct}], unknown: [item, ...] }` (rows only for categories with ≥1 item; `criticalPct` is `null` when the category has zero critical fields), `renderCategoryBreakdown(breakdown)` → HTML string (empty string if nothing to show).

- [ ] **Step 1: Cut `detailTable` and `anCard` out of `renderAnalytics` and paste them at top level**

Inside `renderAnalytics`, find and delete this block (currently right after the `// ── helpers ──` comment, before `function uniqueMap`):

```javascript
  function detailTable(rows, cols) {
    var h = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">';
    h += '<tr>' + cols.map(function(c){ return '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);color:var(--text2);">'+c+'</th>'; }).join('') + '</tr>';
    rows.forEach(function(r) {
      h += '<tr>' + r.map(function(c){ return '<td style="padding:4px 6px;border-bottom:1px solid var(--border);word-break:break-word;">'+c+'</td>'; }).join('') + '</tr>';
    });
    h += '</table>';
    return h;
  }
```

And delete this block (currently right after `uniqueMap` and `itemsTable`, before `var html = '<div class="analytics-grid">';`):

```javascript
  function anCard(title, rows, detailId, detailHtml) {
    var hasErr = rows.some(function(r) { return r[2] === 'err'; });
    var hasWarn = rows.some(function(r) { return r[2] === 'warn'; });
    var sevCls = hasErr ? ' has-err' : hasWarn ? ' has-warn' : '';
    var h = '<div class="an-card'+sevCls+'">';
    h += '<p class="an-card-title">'+title+'</p>';
    rows.forEach(function(r) {
      h += '<div class="an-row"><span class="an-label">'+r[0]+'</span><span class="an-value '+(r[2]||'')+'">'+r[1]+'</span></div>';
    });
    if (detailId && detailHtml) {
      h += '<button class="btn" style="margin-top:10px;font-size:12px;" onclick="showDetail(\''+detailId+'\')">Подробнее</button>';
      h += '<div id="'+detailId+'" style="display:none;margin-top:8px;">'+detailHtml+'</div>';
    }
    h += '</div>';
    return h;
  }
```

`renderAnalytics` still calls `detailTable(...)` and `anCard(...)` by name elsewhere in its body — those calls stay untouched; they'll now resolve to the top-level versions added in Step 2.

- [ ] **Step 2: Paste the two functions at top level, plus the new breakdown functions**

Add this immediately after the `fieldLabel` function added in Task 2 (still before `function getField`):

```javascript
function detailTable(rows, cols) {
  var h = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">';
  h += '<tr>' + cols.map(function(c){ return '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);color:var(--text2);">'+c+'</th>'; }).join('') + '</tr>';
  rows.forEach(function(r) {
    h += '<tr>' + r.map(function(c){ return '<td style="padding:4px 6px;border-bottom:1px solid var(--border);word-break:break-word;">'+c+'</td>'; }).join('') + '</tr>';
  });
  h += '</table>';
  return h;
}

function anCard(title, rows, detailId, detailHtml) {
  var hasErr = rows.some(function(r) { return r[2] === 'err'; });
  var hasWarn = rows.some(function(r) { return r[2] === 'warn'; });
  var sevCls = hasErr ? ' has-err' : hasWarn ? ' has-warn' : '';
  var h = '<div class="an-card'+sevCls+'">';
  h += '<p class="an-card-title">'+title+'</p>';
  rows.forEach(function(r) {
    h += '<div class="an-row"><span class="an-label">'+r[0]+'</span><span class="an-value '+(r[2]||'')+'">'+r[1]+'</span></div>';
  });
  if (detailId && detailHtml) {
    h += '<button class="btn" style="margin-top:10px;font-size:12px;" onclick="showDetail(\''+detailId+'\')">Подробнее</button>';
    h += '<div id="'+detailId+'" style="display:none;margin-top:8px;">'+detailHtml+'</div>';
  }
  h += '</div>';
  return h;
}

function computeCategoryBreakdown(items) {
  var byCat = {};
  var unknown = [];
  items.forEach(function(item) {
    var cat = detectCategory(item);
    if (!cat) { unknown.push(item); return; }
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(item);
  });
  var rows = [];
  CATEGORY_LIST.forEach(function(entry) {
    var catItems = byCat[entry.key];
    if (!catItems || !catItems.length) return;
    var tiers = CATEGORY_FIELD_TIERS[entry.key];
    var criticalFields = CONDITIONAL_FIELDS.filter(function(f) { return tiers[f] === 'critical'; });
    var criticalTotal = catItems.length * criticalFields.length;
    var criticalFilled = 0;
    catItems.forEach(function(item) {
      criticalFields.forEach(function(f) { if (item[f]) criticalFilled++; });
    });
    rows.push({
      key: entry.key,
      label: entry.label,
      count: catItems.length,
      criticalFieldCount: criticalFields.length,
      criticalPct: criticalFields.length ? pct(criticalFilled, criticalTotal) : null
    });
  });
  return { rows: rows, unknown: unknown };
}

function renderCategoryBreakdown(breakdown) {
  if (!breakdown.rows.length && !breakdown.unknown.length) return '';
  var html = '<p style="margin:0 0 .75rem;font-size:15px;font-weight:600;">Разбивка по категориям</p><div class="analytics-grid" style="margin-bottom:1.5rem;">';
  breakdown.rows.forEach(function(row) {
    var pctRow = row.criticalPct === null
      ? ['Критичные поля', 'нет критичных полей для категории', '']
      : ['Критичные поля заполнены', row.criticalPct + '%', row.criticalPct === 100 ? 'ok' : row.criticalPct >= 50 ? 'warn' : 'err'];
    html += anCard(row.label, [
      ['Товаров', row.count.toLocaleString('ru'), ''],
      pctRow
    ]);
  });
  if (breakdown.unknown.length) {
    var detailHtml = detailTable(breakdown.unknown.slice(0, 30).map(function(i) { return [i.title || '—']; }), ['Название'])
      + (breakdown.unknown.length > 30 ? '<p style="font-size:11px;color:var(--text3);margin:4px 0 0">...и ещё ' + (breakdown.unknown.length - 30) + '</p>' : '');
    html += anCard('Категория не определена', [
      ['Товаров', breakdown.unknown.length.toLocaleString('ru'), 'warn']
    ], 'detail-category-unknown', detailHtml);
  }
  html += '</div>';
  return html;
}
```

- [ ] **Step 3: Verify with a throwaway node script**

Create `scratch-task3.js` in the repo root. It needs `detectCategory`/`CATEGORY_KEYWORDS` (Task 2), `CATEGORY_LIST`/`CATEGORY_FIELD_TIERS`/`CONDITIONAL_FIELDS` (Task 1), and `pct` (existing top-level helper), plus the new functions from Step 2 above:

```javascript
var CONDITIONAL_FIELDS = ['brand', 'color', 'size', 'size_system', 'gender', 'age_group', 'item_group_id', 'sale_price'];
var CATEGORY_LIST = [
  { key: 'odezhda', label: 'Одежда' },
  { key: 'obuv', label: 'Обувь' },
  { key: 'dom', label: 'Товары для дома' },
  { key: 'books_media', label: 'Книги, музыка и фильмы' }
];
var CATEGORY_FIELD_TIERS = {
  odezhda: { brand: 'critical', color: 'medium', size: 'critical', size_system: 'critical', gender: 'critical', age_group: 'critical', item_group_id: 'critical', sale_price: 'optional' },
  obuv: { brand: 'critical', color: 'medium', size: 'critical', size_system: 'critical', gender: 'critical', age_group: 'critical', item_group_id: 'critical', sale_price: 'optional' },
  dom: { brand: 'critical', color: 'medium', size: 'medium', size_system: 'optional', gender: 'optional', age_group: 'optional', item_group_id: 'optional', sale_price: 'optional' },
  books_media: { brand: 'medium', color: 'optional', size: 'optional', size_system: 'optional', gender: 'optional', age_group: 'medium', item_group_id: 'medium', sale_price: 'optional' }
};
function detectCategory(item) { return item.__testCat || null; } // stubbed for this isolated test
function pct(n, total) { return total ? Math.round(n / total * 100) : 0; }

function computeCategoryBreakdown(items) {
  var byCat = {};
  var unknown = [];
  items.forEach(function(item) {
    var cat = detectCategory(item);
    if (!cat) { unknown.push(item); return; }
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(item);
  });
  var rows = [];
  CATEGORY_LIST.forEach(function(entry) {
    var catItems = byCat[entry.key];
    if (!catItems || !catItems.length) return;
    var tiers = CATEGORY_FIELD_TIERS[entry.key];
    var criticalFields = CONDITIONAL_FIELDS.filter(function(f) { return tiers[f] === 'critical'; });
    var criticalTotal = catItems.length * criticalFields.length;
    var criticalFilled = 0;
    catItems.forEach(function(item) {
      criticalFields.forEach(function(f) { if (item[f]) criticalFilled++; });
    });
    rows.push({
      key: entry.key,
      label: entry.label,
      count: catItems.length,
      criticalFieldCount: criticalFields.length,
      criticalPct: criticalFields.length ? pct(criticalFilled, criticalTotal) : null
    });
  });
  return { rows: rows, unknown: unknown };
}

var assert = require('assert');
var items = [
  { __testCat: 'odezhda', brand: 'Nike', size: 'M' },                  // odezhda: 2/7 critical fields filled
  { __testCat: 'odezhda', brand: null, size: null },                   // odezhda: 0/7 filled
  { __testCat: 'dom', brand: 'IKEA' },                                 // dom: 1/1 critical field filled (only brand is critical)
  { __testCat: 'books_media', brand: null },                           // books_media: zero critical fields -> criticalPct must be null
  { __testCat: null, title: 'mystery item' }                           // unknown bucket
];
var result = computeCategoryBreakdown(items);
var odezhda = result.rows.filter(function(r) { return r.key === 'odezhda'; })[0];
assert.ok(odezhda, 'odezhda row must exist');
assert.strictEqual(odezhda.count, 2);
assert.strictEqual(odezhda.criticalFieldCount, 7);
var dom = result.rows.filter(function(r) { return r.key === 'dom'; })[0];
assert.strictEqual(dom.criticalPct, 100, 'dom has only brand critical, and it is filled -> 100%');
var booksMedia = result.rows.filter(function(r) { return r.key === 'books_media'; })[0];
assert.strictEqual(booksMedia.criticalPct, null, 'books_media has zero critical fields -> null, not 0%');
assert.strictEqual(result.unknown.length, 1);
console.log('OK: task 3 breakdown verified');
```

Run: `node scratch-task3.js`
Expected output: `OK: task 3 breakdown verified`

- [ ] **Step 4: Delete the scratch file**

Run: `rm scratch-task3.js`

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "Add category breakdown panel (hoist anCard/detailTable to top level)"
```

---

### Task 4: Tiered field recommendations

**Files:**
- Modify: `public/index.html` — add `buildTieredFieldRecs` next to the functions added in Task 3.

**Interfaces:**
- Consumes: `CONDITIONAL_FIELDS`, `CATEGORY_LIST`, `CATEGORY_FIELD_TIERS` (Task 1), `detectCategory`, `fieldLabel` (Task 2).
- Produces: `buildTieredFieldRecs(items)` → array of `{sev: 'err'|'warn', text, plain}` objects, same shape as the existing `recs` entries `renderAnalytics` already pushes.

- [ ] **Step 1: Add the function**

Add this immediately after `renderCategoryBreakdown` (added in Task 3), still before `function getField`:

```javascript
function buildTieredFieldRecs(items) {
  var recs = [];
  CONDITIONAL_FIELDS.forEach(function(field) {
    var critCats = {}, warnCats = {}, critTotal = 0, warnTotal = 0;
    items.forEach(function(item) {
      if (item[field]) return;
      var cat = detectCategory(item);
      if (!cat) return;
      var tier = CATEGORY_FIELD_TIERS[cat][field];
      if (tier === 'critical') { critTotal++; critCats[cat] = true; }
      else if (tier === 'medium') { warnTotal++; warnCats[cat] = true; }
    });
    var label = fieldLabel(field);
    if (critTotal) {
      var critList = CATEGORY_LIST.filter(function(c) { return critCats[c.key]; }).map(function(c) { return c.label; }).join(', ');
      recs.push({
        sev: 'err',
        text: 'Заполните <b>' + label + '</b> — не заполнено у ' + critTotal + ' товаров в категориях, где это критично: ' + critList + '.',
        plain: 'Заполните ' + label + ' — не заполнено у ' + critTotal + ' товаров в категориях, где это критично: ' + critList + '.'
      });
    }
    if (warnTotal) {
      var warnList = CATEGORY_LIST.filter(function(c) { return warnCats[c.key]; }).map(function(c) { return c.label; }).join(', ');
      recs.push({
        sev: 'warn',
        text: 'Рекомендуется заполнить <b>' + label + '</b> — не заполнено у ' + warnTotal + ' товаров в категориях: ' + warnList + '.',
        plain: 'Рекомендуется заполнить ' + label + ' — не заполнено у ' + warnTotal + ' товаров в категориях: ' + warnList + '.'
      });
    }
  });
  return recs;
}
```

- [ ] **Step 2: Verify with a throwaway node script, reproducing the spec's worked example (section 5, `age_group`)**

Create `scratch-task4.js`:

```javascript
var CONDITIONAL_FIELDS = ['brand', 'color', 'size', 'size_system', 'gender', 'age_group', 'item_group_id', 'sale_price'];
var CATEGORY_LIST = [
  { key: 'odezhda', label: 'Одежда' },
  { key: 'obuv', label: 'Обувь' },
  { key: 'dom', label: 'Товары для дома' },
  { key: 'detskie', label: 'Детские товары' },
  { key: 'elektronika', label: 'Электроника' },
  { key: 'sport', label: 'Спортивные товары' },
  { key: 'school_creativity', label: 'Школа и творчество' }
];
var CATEGORY_FIELD_TIERS = {
  odezhda: { age_group: 'critical' },
  obuv: { age_group: 'critical' },
  dom: { age_group: 'optional' },
  detskie: { age_group: 'critical' },
  elektronika: { age_group: 'optional' },
  sport: { age_group: 'medium' },
  school_creativity: { age_group: 'critical' }
};
// Only age_group is exercised in this isolated test; stub the rest of the loop harmlessly.
CONDITIONAL_FIELDS.slice(1).forEach(function (f) {
  Object.keys(CATEGORY_FIELD_TIERS).forEach(function (k) { CATEGORY_FIELD_TIERS[k][f] = 'optional'; });
});
function detectCategory(item) { return item.__testCat || null; }
function fieldLabel(key) { return key === 'age_group' ? 'Возрастная группа' : key; }

function buildTieredFieldRecs(items) {
  var recs = [];
  CONDITIONAL_FIELDS.forEach(function(field) {
    var critCats = {}, warnCats = {}, critTotal = 0, warnTotal = 0;
    items.forEach(function(item) {
      if (item[field]) return;
      var cat = detectCategory(item);
      if (!cat) return;
      var tier = CATEGORY_FIELD_TIERS[cat][field];
      if (tier === 'critical') { critTotal++; critCats[cat] = true; }
      else if (tier === 'medium') { warnTotal++; warnCats[cat] = true; }
    });
    var label = fieldLabel(field);
    if (critTotal) {
      var critList = CATEGORY_LIST.filter(function(c) { return critCats[c.key]; }).map(function(c) { return c.label; }).join(', ');
      recs.push({ sev: 'err', text: 'Заполните <b>' + label + '</b> — не заполнено у ' + critTotal + ' товаров в категориях, где это критично: ' + critList + '.', plain: '' });
    }
    if (warnTotal) {
      var warnList = CATEGORY_LIST.filter(function(c) { return warnCats[c.key]; }).map(function(c) { return c.label; }).join(', ');
      recs.push({ sev: 'warn', text: 'Рекомендуется заполнить <b>' + label + '</b> — не заполнено у ' + warnTotal + ' товаров в категориях: ' + warnList + '.', plain: '' });
    }
  });
  return recs;
}

var assert = require('assert');
var items = [
  { __testCat: 'odezhda' }, { __testCat: 'obuv' }, { __testCat: 'detskie' }, { __testCat: 'school_creativity' }, // critical, unfilled
  { __testCat: 'sport' },                                                                                        // medium, unfilled
  { __testCat: 'dom' }, { __testCat: 'elektronika' },                                                            // optional, unfilled -> excluded
  { __testCat: null },                                                                                            // unknown -> excluded
  { __testCat: 'odezhda', age_group: 'kids' }                                                                     // filled -> excluded
];
var recs = buildTieredFieldRecs(items);
assert.strictEqual(recs.length, 2, 'expected exactly one err and one warn rec for age_group');
var errRec = recs.filter(function (r) { return r.sev === 'err'; })[0];
var warnRec = recs.filter(function (r) { return r.sev === 'warn'; })[0];
assert.ok(errRec.text.indexOf('4 товаров') !== -1, 'err rec should count 4 critical-tier unfilled items, got: ' + errRec.text);
assert.ok(errRec.text.indexOf('Одежда') !== -1 && errRec.text.indexOf('Обувь') !== -1 && errRec.text.indexOf('Детские товары') !== -1 && errRec.text.indexOf('Школа и творчество') !== -1, 'err rec must list all 4 critical categories: ' + errRec.text);
assert.ok(warnRec.text.indexOf('1 товаров') !== -1, 'warn rec should count 1 medium-tier unfilled item, got: ' + warnRec.text);
assert.ok(warnRec.text.indexOf('Спортивные товары') !== -1, 'warn rec must name the medium category: ' + warnRec.text);
console.log('OK: task 4 tiered recs verified');
```

Run: `node scratch-task4.js`
Expected output: `OK: task 4 tiered recs verified`

- [ ] **Step 3: Delete the scratch file**

Run: `rm scratch-task4.js`

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "Add tiered field recommendations by category"
```

---

### Task 5: Wire into `renderAnalytics` + manual smoke test

**Files:**
- Modify: `public/index.html` (inside `renderAnalytics`)

**Interfaces:**
- Consumes: `computeCategoryBreakdown`, `renderCategoryBreakdown` (Task 3), `buildTieredFieldRecs` (Task 4).
- Produces: no new interface — this task only rewires `renderAnalytics`'s existing `html` and `recs` locals.

- [ ] **Step 1: Prepend the category breakdown panel**

Find this line inside `renderAnalytics` (right after the `anCard`/helper functions, where the visible analytics cards start):

```javascript
  var html = '<div class="analytics-grid">';
```

Replace with:

```javascript
  var html = renderCategoryBreakdown(computeCategoryBreakdown(items));
  html += '<div class="analytics-grid">';
```

- [ ] **Step 2: Replace the flat brand recommendation with the tiered block**

Find:

```javascript
  if (brandFilled < total)
    recs.push({ sev: 'warn', text: 'Заполните бренд (<b>brand</b>) у ' + (total-brandFilled) + ' товаров.', plain: 'Заполните бренд (brand) у ' + (total-brandFilled) + ' товаров.' });
```

Replace with:

```javascript
  recs = recs.concat(buildTieredFieldRecs(items));
```

- [ ] **Step 3: Remove the now-redundant flat `item_group_id` recommendation**

Find and delete:

```javascript
  if (noGroup.length)
    recs.push({ sev: 'warn', text: 'Добавьте <b>item_group_id</b> для группировки вариантов товара. Отсутствует у ' + noGroup.length + ' позиций.', plain: 'Добавьте item_group_id для группировки вариантов товара. Отсутствует у ' + noGroup.length + ' позиций.' });
```

(No replacement — `item_group_id` is now covered by the tiered block added in Step 2. The `groupFilled`/`noGroup` variables and the "Группировка (item_group_id)" analytics card stay untouched; only this one flat recommendation line is removed.)

- [ ] **Step 4: Confirm the file still parses**

`public/index.html` has exactly one inline `<script>` block (the other `<script src="...">` tag only loads the XLSX library, no inline body). Extract just that block and check it with `node --check`, rather than checking the whole `.html` file (which would fail immediately on the `<!DOCTYPE` and never actually look at the script):

```bash
sed -n '/^<script>$/,/^<\/script>$/{ /^<script>$/d; /^<\/script>$/d; p; }' public/index.html > scratch-syntax-check.js
node --check scratch-syntax-check.js
rm scratch-syntax-check.js
```

Expected: no output from `node --check` and exit code 0. If it reports a syntax error, the line number is relative to the extracted block (add ~608 to map back to `public/index.html`) — fix it before proceeding.

- [ ] **Step 5: Manual smoke test (per spec section 6 — no browser in this environment, so this step is for you to run locally)**

1. Serve `public/` locally and open the feed analyzer.
2. Load the same BCC Mall / Xiaomi-style feed used when this spec was validated (mix of smartphones, TVs, wearables, appliances — the case that originally showed category mixing).
3. Confirm:
   - A "Разбивка по категориям" panel appears at the top of the results, before the existing cards.
   - Each detected category shows a товаров count and either a critical-field percentage or "нет критичных полей для категории".
   - Items that don't match any of the 9 keyword-covered categories appear under "Категория не определена" with a working "Подробнее" toggle.
   - The recommendations list no longer has a flat "Заполните бренд" line; instead it has per-category-tier lines for brand and the other 7 conditional fields, split into critical (err, red) and medium (warn, amber) where applicable.
   - "Копировать всё" / per-recommendation copy buttons still work on the new tiered lines.
4. If anything above fails visibly, fix it and re-check before moving on — per the design spec, this manual pass is the verification of record for this feature (no automated frontend tests exist in this project).

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "Wire category breakdown and tiered recommendations into renderAnalytics"
```

---

## Self-Review

**Spec coverage:**
- Section 1 (scope) — reflected in Global Constraints; no backend/`#tab-fields` changes made (Tasks 1–5 only touch `renderAnalytics` and its neighboring top-level helpers).
- Section 2 (matrix) — Task 1, values copied verbatim from the corrected spec table.
- Section 3 (detection) — Task 2, 9 keyword-covered categories, 3 unconfirmed categories left undetectable (asserted in Task 2's verification script), conflict example (браслет) reproduced as a test case.
- Section 4 (breakdown panel) — Task 3, including the "нет критичных полей" edge case for `books_media` and the "Категория не определена" bucket with detail list.
- Section 5 (recompute) — Task 4 (builder) + Task 5 Steps 2–3 (wiring/removal of superseded flat recs), worked example matches the spec's `age_group` illustration.
- Section 6 (testing) — honored as-is: no test framework introduced; throwaway `node` scripts for pure-logic tasks, manual smoke test for the wired-up UI, matching the project's established approach for frontend work.

**Placeholder scan:** no TBD/TODO; every step has complete, runnable code.

**Type consistency:** `detectCategory` always returns a category key from `CATEGORY_LIST` or `null` — checked consistently in Tasks 3 and 4. `CONDITIONAL_FIELDS` keys match `CATEGORY_FIELD_TIERS` sub-object keys and `FIELDS` array keys (verified in Task 1's and Task 2's scratch scripts). `buildTieredFieldRecs` output shape (`{sev, text, plain}`) matches what `renderAnalytics` already expects from existing `recs.push(...)` calls.
