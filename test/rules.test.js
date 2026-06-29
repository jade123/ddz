const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, canBeat } = require("../server");

function card(rank, suit = "♠") {
  return { id: `${suit}${rank}${Math.random()}`, rank, suit, label: `${suit}${rank}` };
}

test("recognizes common Dou Dizhu patterns", () => {
  assert.equal(analyze([card(7)]).type, "single");
  assert.equal(analyze([card(8), card(8, "♥")]).type, "pair");
  assert.equal(analyze([card(9), card(9, "♥"), card(9, "♣"), card(9, "♦")]).type, "bomb");
  assert.equal(analyze([card(16, "☆"), card(17, "★")]).type, "rocket");
  assert.equal(analyze([card(3), card(4), card(5), card(6), card(7)]).type, "straight");
  assert.equal(analyze([card(10), card(11), card(12), card(13), card(15)]), null);
});

test("compares playable hands", () => {
  const singleSeven = analyze([card(7)]);
  const singleQueen = analyze([card(12)]);
  const bomb = analyze([card(4), card(4, "♥"), card(4, "♣"), card(4, "♦")]);
  const rocket = analyze([card(16, "☆"), card(17, "★")]);

  assert.equal(canBeat(singleQueen, singleSeven), true);
  assert.equal(canBeat(singleSeven, singleQueen), false);
  assert.equal(canBeat(bomb, singleQueen), true);
  assert.equal(canBeat(rocket, bomb), true);
});
