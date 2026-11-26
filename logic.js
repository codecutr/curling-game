// Pure game-logic functions, kept free of DOM/canvas/Math.random side effects
// so they can run under both the browser (via the CurlingLogic global) and
// Node's test runner (via module.exports) without any extra tooling.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CurlingLogic = factory();
  }
}(typeof window !== 'undefined' ? window : globalThis, function () {

  // Whose throw is it, given the per-end alternating order and which team
  // threw first this end.
  function currentTeamForShot(teams, shotIndex, startingTeamIndex) {
    const order = startingTeamIndex === 0 ? teams : [teams[1], teams[0]];
    return order[shotIndex % 2];
  }

  // Ice gets faster (less friction) each end, floored at minMult of the
  // end-1 value.
  function computeIceFriction(baseFriction, endNumber, speedupPerEnd, minMult) {
    const mult = Math.max(minMult, 1 - (endNumber - 1) * speedupPerEnd);
    return baseFriction * mult;
  }

  // A stone is "hogged" only on its own original delivery: it must not
  // already have rested once before (e.g. settled, then got knocked around
  // by a later hit), and it must not already be out of play for another
  // reason.
  function isHogged(stone, stoneRadius, farHogY) {
    return !stone.hasRestedBefore && !stone.outOfPlay && stone.y + stoneRadius >= farHogY;
  }

  // The opponent's best (closest-to-button) in-house stone, or null if the
  // opponent has nothing in the house. Used by the AI to decide a takeout
  // target; the random "attempt it or not" decision stays with the caller.
  function findBestOpponentStone(stones, myTeam, houseX, houseY, houseRadius) {
    const dist = (s) => Math.hypot(s.x - houseX, s.y - houseY);
    const candidates = stones
      .filter((s) => !s.outOfPlay && s.team !== myTeam && dist(s) <= houseRadius)
      .sort((a, b) => dist(a) - dist(b));
    return candidates[0] || null;
  }

  // End-of-end scoring: the team with the stone closest to the button
  // scores one point for each of its stones closer than the opponent's
  // best. Returns { leader: null, count: 0 } for a blank end.
  function scoreEnd(stones, houseX, houseY, houseRadius) {
    const dist = (s) => Math.hypot(s.x - houseX, s.y - houseY);
    const eligible = stones.filter((s) => !s.outOfPlay && dist(s) <= houseRadius);

    if (eligible.length === 0) {
      return { leader: null, count: 0 };
    }

    const byTeam = { red: [], yellow: [] };
    eligible.forEach((s) => byTeam[s.team].push(dist(s)));
    byTeam.red.sort((a, b) => a - b);
    byTeam.yellow.sort((a, b) => a - b);

    const redBest = byTeam.red[0] ?? Infinity;
    const yellowBest = byTeam.yellow[0] ?? Infinity;
    const leader = redBest < yellowBest ? 'red' : 'yellow';
    const opponentBest = leader === 'red' ? yellowBest : redBest;
    const count = byTeam[leader].filter((d) => d < opponentBest).length;

    return { leader, count };
  }

  return {
    currentTeamForShot,
    computeIceFriction,
    isHogged,
    findBestOpponentStone,
    scoreEnd,
  };
}));
