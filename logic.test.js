const test = require('node:test');
const assert = require('node:assert/strict');
const {
  currentTeamForShot,
  computeIceFriction,
  isHogged,
  findBestOpponentStone,
  scoreEnd,
} = require('./logic.js');

const TEAMS = ['red', 'yellow'];
const HOUSE_X = 220;
const HOUSE_Y = 140;
const HOUSE_R = 130;
const STONE_R = 13;
const FAR_HOG_Y = 320;

function stone(overrides) {
  return {
    x: HOUSE_X,
    y: HOUSE_Y,
    team: 'red',
    outOfPlay: false,
    hasRestedBefore: false,
    ...overrides,
  };
}

test('currentTeamForShot alternates within an end', () => {
  assert.equal(currentTeamForShot(TEAMS, 0, 0), 'red');
  assert.equal(currentTeamForShot(TEAMS, 1, 0), 'yellow');
  assert.equal(currentTeamForShot(TEAMS, 2, 0), 'red');
  assert.equal(currentTeamForShot(TEAMS, 7, 0), 'yellow');
});

test('currentTeamForShot honors which team starts the end', () => {
  assert.equal(currentTeamForShot(TEAMS, 0, 1), 'yellow');
  assert.equal(currentTeamForShot(TEAMS, 1, 1), 'red');
});

test('computeIceFriction is unchanged on end 1', () => {
  assert.equal(computeIceFriction(50, 1, 0.04, 0.75), 50);
});

test('computeIceFriction decreases 4% per end', () => {
  assert.equal(computeIceFriction(50, 2, 0.04, 0.75), 48);
  assert.equal(computeIceFriction(50, 3, 0.04, 0.75), 46);
});

test('computeIceFriction is floored at minMult of the base', () => {
  assert.equal(computeIceFriction(50, 50, 0.04, 0.75), 37.5);
});

test('isHogged is true for a stone resting on its first delivery short of the hog line', () => {
  const s = stone({ y: FAR_HOG_Y, hasRestedBefore: false, outOfPlay: false });
  assert.equal(isHogged(s, STONE_R, FAR_HOG_Y), true);
});

test('isHogged is false for a stone that cleared the hog line', () => {
  const s = stone({ y: FAR_HOG_Y - STONE_R - 1, hasRestedBefore: false, outOfPlay: false });
  assert.equal(isHogged(s, STONE_R, FAR_HOG_Y), false);
});

test('isHogged is false once a stone has already rested before (re-settling after a hit)', () => {
  const s = stone({ y: FAR_HOG_Y, hasRestedBefore: true, outOfPlay: false });
  assert.equal(isHogged(s, STONE_R, FAR_HOG_Y), false);
});

test('isHogged is false for a stone already out of play for another reason', () => {
  const s = stone({ y: FAR_HOG_Y, hasRestedBefore: false, outOfPlay: true });
  assert.equal(isHogged(s, STONE_R, FAR_HOG_Y), false);
});

test('findBestOpponentStone returns the closest in-house opponent stone', () => {
  const stones = [
    stone({ team: 'yellow', x: HOUSE_X, y: HOUSE_Y + 50 }), // 50px from button
    stone({ team: 'yellow', x: HOUSE_X, y: HOUSE_Y + 10 }), // 10px from button, closer
    stone({ team: 'red', x: HOUSE_X, y: HOUSE_Y }), // own team, ignored
  ];
  const best = findBestOpponentStone(stones, 'red', HOUSE_X, HOUSE_Y, HOUSE_R);
  assert.equal(best.y, HOUSE_Y + 10);
});

test('findBestOpponentStone ignores stones outside the house', () => {
  const stones = [stone({ team: 'yellow', x: HOUSE_X, y: HOUSE_Y + HOUSE_R + 50 })];
  assert.equal(findBestOpponentStone(stones, 'red', HOUSE_X, HOUSE_Y, HOUSE_R), null);
});

test('findBestOpponentStone ignores stones that are out of play', () => {
  const stones = [stone({ team: 'yellow', x: HOUSE_X, y: HOUSE_Y, outOfPlay: true })];
  assert.equal(findBestOpponentStone(stones, 'red', HOUSE_X, HOUSE_Y, HOUSE_R), null);
});

test('findBestOpponentStone returns null when the house is empty', () => {
  assert.equal(findBestOpponentStone([], 'red', HOUSE_X, HOUSE_Y, HOUSE_R), null);
});

test('scoreEnd is blank when no stones are in the house', () => {
  const stones = [stone({ x: 0, y: 0 })];
  const result = scoreEnd(stones, HOUSE_X, HOUSE_Y, HOUSE_R);
  assert.deepEqual(result, { leader: null, count: 0 });
});

test('scoreEnd ignores stones that are out of play', () => {
  const stones = [stone({ outOfPlay: true })];
  const result = scoreEnd(stones, HOUSE_X, HOUSE_Y, HOUSE_R);
  assert.deepEqual(result, { leader: null, count: 0 });
});

test('scoreEnd awards the closer team one point for a single shot', () => {
  const stones = [
    stone({ team: 'red', x: HOUSE_X, y: HOUSE_Y }),
    stone({ team: 'yellow', x: HOUSE_X, y: HOUSE_Y + 40 }),
  ];
  const result = scoreEnd(stones, HOUSE_X, HOUSE_Y, HOUSE_R);
  assert.deepEqual(result, { leader: 'red', count: 1 });
});

test('scoreEnd counts every leader stone closer than the opponent\'s best', () => {
  const stones = [
    stone({ team: 'red', x: HOUSE_X, y: HOUSE_Y }), // on the button
    stone({ team: 'red', x: HOUSE_X, y: HOUSE_Y + 5 }), // also closer than yellow's best
    stone({ team: 'yellow', x: HOUSE_X, y: HOUSE_Y + 40 }),
  ];
  const result = scoreEnd(stones, HOUSE_X, HOUSE_Y, HOUSE_R);
  assert.deepEqual(result, { leader: 'red', count: 2 });
});

test('scoreEnd does not count a leader stone farther than the opponent\'s best', () => {
  const stones = [
    stone({ team: 'red', x: HOUSE_X, y: HOUSE_Y }), // on the button, this one counts
    stone({ team: 'red', x: HOUSE_X, y: HOUSE_Y + 45 }), // farther than yellow's best, doesn't count
    stone({ team: 'yellow', x: HOUSE_X, y: HOUSE_Y + 40 }),
  ];
  const result = scoreEnd(stones, HOUSE_X, HOUSE_Y, HOUSE_R);
  assert.deepEqual(result, { leader: 'red', count: 1 });
});
