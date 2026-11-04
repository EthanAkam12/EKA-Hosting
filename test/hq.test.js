import { test } from "node:test";
import assert from "node:assert/strict";
import { guessDesign, AGENTS } from "../server/hq.js";

test("HQ picks a design from the business description", () => {
  assert.equal(guessDesign("Rosie's Bakery, cakes and coffee"), "restaurant");
  assert.equal(guessDesign("Emergency plumber in Leeds"), "trades");
  assert.equal(guessDesign("Hair and beauty salon"), "salon");
  assert.equal(guessDesign("Family law solicitors"), "professional");
  assert.equal(guessDesign("Something else entirely"), "onepage");
  assert.deepEqual(Object.keys(AGENTS), ["support", "builder", "account", "ops", "marketing"]);
});
