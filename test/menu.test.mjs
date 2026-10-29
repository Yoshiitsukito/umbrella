import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonReply } from "../lib/ai.mjs";
import { addItem, cleanItem, cleanNutrition, dailyKcal, eatenKcal, ensureMenu, findItem, menuDate, menuItems, menuTotals, removeItem, shiftMenu, toggleEaten } from "../lib/menu.mjs";

test("a dish needs a meal, a type and a name; portion and calories are optional", () => {
  assert.equal(cleanItem({ category: "main", name: "Бууз" }).error, "Хоолны цагаа сонгоно уу");
  assert.equal(cleanItem({ meal: "lunch", name: "Бууз" }).error, "Төрлөө сонгоно уу");
  assert.match(cleanItem({ meal: "lunch", category: "main", name: "<b>" }).error, /Хоолны нэр/);
  const { item } = cleanItem({ meal: "lunch", category: "main", name: "  Бууз  ", portion: "" });
  assert.deepEqual(item, { meal: "lunch", category: "main", name: "Бууз", portion: null, unit: "г", kcal: null, note: null });
  assert.equal(cleanItem({ meal: "night", category: "drink", name: "Сүүтэй цай", portion: 250 }).item.unit, "мл");
  assert.equal(cleanItem({ meal: "lunch", category: "main", name: "Бууз", kcal: "450" }).item.kcal, 450);
  assert.match(cleanItem({ meal: "lunch", category: "main", name: "Бууз", portion: 5000 }).error, /Порц/);
});

test("AI estimates are checked before they are stored", () => {
  const item = { name: "Цуйван", category: "main", meal: "lunch", portion: null, unit: "г" };
  const clean = cleanNutrition({ kcal: 612.4, protein_g: 24, fat_g: 28, carbs_g: 70, portion: 350, note: "Үхрийн махтай" }, item);
  assert.deepEqual(clean, { kcal: 612, protein: 24, fat: 28, carbs: 70, portion: 350, aiNote: "Үхрийн махтай" });
  assert.throws(() => cleanNutrition({ kcal: "lots" }, item), /калори/);
  assert.equal(cleanNutrition({ kcal: 100, protein_g: 9999 }, { ...item, portion: 200 }).protein, null);
  assert.deepEqual(parseJsonReply('Here you go: {"kcal": 300} done'), { kcal: 300 });
  assert.throws(() => parseJsonReply("no json"), /JSON/);
});

test("the kitchen edits a week back and two weeks ahead", () => {
  assert.equal(menuDate("2026-10-28", "2026-10-28"), "2026-10-28");
  assert.equal(menuDate("2026-10-21", "2026-10-28"), "2026-10-21");
  assert.equal(menuDate("2026-10-20", "2026-10-28"), null);
  assert.equal(menuDate("2026-11-11", "2026-10-28"), "2026-11-11");
  assert.equal(menuDate("2026-11-12", "2026-10-28"), null);
});

test("menu items sort by meal and type, total per meal, and can be removed", () => {
  const db = {};
  ensureMenu(db);
  const now = Date.parse("2026-10-28T03:00:00Z");
  addItem(db, "2026-10-28", { meal: "lunch", category: "drink", name: "Цай", kcal: 80 }, "k", "2026-10-28", now);
  const soup = addItem(db, "2026-10-28", { meal: "lunch", category: "soup", name: "Гурилтай шөл", kcal: 420 }, "k", "2026-10-28", now + 1).item;
  addItem(db, "2026-10-28", { meal: "breakfast", category: "main", name: "Будаа", kcal: null }, "k", "2026-10-28", now + 2);
  assert.deepEqual(menuItems(db, "2026-10-28").map((item) => item.name), ["Будаа", "Гурилтай шөл", "Цай"]);
  assert.deepEqual(menuTotals(menuItems(db, "2026-10-28")), { meals: { breakfast: 0, lunch: 500, dinner: 0, night: 0 }, total: 500, pending: 1 });
  assert.equal(findItem(db, soup.id).date, "2026-10-28");
  assert.equal(removeItem(db, soup.id), true);
  assert.equal(findItem(db, soup.id), null);
});

test("a day shift eats breakfast, lunch and dinner; a night shift dinner, night meal and the next breakfast", () => {
  const db = {};
  ensureMenu(db);
  const now = Date.parse("2026-10-28T03:00:00Z");
  const add = (date, meal, name) => addItem(db, date, { meal, category: "main", name, kcal: 100 }, "k", "2026-10-28", now);
  add("2026-10-28", "breakfast", "Будаа");
  add("2026-10-28", "lunch", "Цуйван");
  add("2026-10-28", "dinner", "Хуушуур");
  add("2026-10-28", "night", "Банштай шөл");
  add("2026-10-29", "breakfast", "Сүүтэй цай");
  const day = shiftMenu(db, "2026-10-28", "day");
  assert.deepEqual(day.meals, ["breakfast", "lunch", "dinner"]);
  assert.deepEqual(day.items.map((item) => item.name), ["Будаа", "Цуйван", "Хуушуур"]);
  assert.equal(shiftMenu(db, "2026-10-28", "off").shift, "day");
  const night = shiftMenu(db, "2026-10-28", "night");
  assert.deepEqual(night.meals, ["dinner", "night", "breakfast"]);
  assert.equal(night.morning, "2026-10-29");
  assert.deepEqual(night.items.map((item) => item.name), ["Хуушуур", "Банштай шөл", "Сүүтэй цай"]);
});

test("eating a dish counts its calories and marks the meal", () => {
  const items = [
    { id: "a", meal: "lunch", kcal: 420 },
    { id: "b", meal: "lunch", kcal: 80 },
    { id: "c", meal: "night", kcal: 650 },
  ];
  const day = {};
  toggleEaten(day, items, "a");
  toggleEaten(day, items, "c");
  assert.deepEqual(day.eaten, ["a", "c"]);
  assert.deepEqual(day.meals, { lunch: true, dinner: true });
  assert.equal(eatenKcal(items, day.eaten), 1070);
  toggleEaten(day, items, "a");
  assert.deepEqual(day.meals, { lunch: false, dinner: true });
});

test("the daily calorie guide follows weight and shift days", () => {
  assert.equal(dailyKcal(70, true), 2250);
  assert.equal(dailyKcal(70, false), 1950);
  assert.equal(dailyKcal(null, true), 2300);
});
