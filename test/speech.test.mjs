import test from "node:test";
import assert from "node:assert/strict";
import { numberWords, speakableMongolian } from "../lib/speech.mjs";

test("numbers use the standalone or the before-a-noun form", () => {
  assert.equal(numberWords(5), "тав");
  assert.equal(numberWords(5, true), "таван");
  assert.equal(numberWords(10), "арав");
  assert.equal(numberWords(15), "арван тав");
  assert.equal(numberWords(15, true), "арван таван");
  assert.equal(numberWords(20), "хорь");
  assert.equal(numberWords(21, true), "хорин нэг");
  assert.equal(numberWords(100), "зуу");
  assert.equal(numberWords(120), "зуун хорь");
  assert.equal(numberWords(2026, true), "хоёр мянга хорин зургаан");
  assert.equal(numberWords(0), "тэг");
});

test("announcements read numbers, times and signs as Mongolian words", () => {
  assert.equal(
    speakableMongolian("Анхааруулга! Спорт заалны гэрэл 15 минутын дараа автоматаар унтарна."),
    "Анхааруулга! Спорт заалны гэрэл арван таван минутын дараа автоматаар унтарна.",
  );
  assert.equal(speakableMongolian("Гэрэл 5 минутын дараа"), "Гэрэл таван минутын дараа");
  assert.equal(speakableMongolian("Одоо 21:45 болж байна."), "Одоо хорин нэг цаг дөчин таван минут болж байна.");
  assert.equal(speakableMongolian("06:00 цагт асна"), "зургаан цагт асна");
  assert.equal(speakableMongolian("Эхлэх цаг 18:00."), "Эхлэх цаг арван найман цаг.");
  assert.equal(speakableMongolian("Гадаа -7 градус"), "Гадаа хасах долоон градус");
  assert.equal(speakableMongolian("магадлал 55%"), "магадлал тавин таван хувь");
  assert.equal(speakableMongolian("10 сарын 28"), "арван сарын хорин найм");
  assert.equal(speakableMongolian("15-нд"), "арван тавнд");
  assert.equal(speakableMongolian("секундэд 3 метр"), "секундэд гурван метр");
});
