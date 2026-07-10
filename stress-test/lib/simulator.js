"use strict";
const oracle = require("./oracle");
const handEntry = require("./pageobjects/handEntry");
const newGame = require("./pageobjects/newGame");
const bracket = require("./pageobjects/bracket");

/** Small deterministic PRNG so a failing run's dice can be reproduced from a logged seed. */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function crossCheck(page, oracleDeals, dealIndex, { logger, contextLabel } = {}) {
  const expected = oracle.finalTotals(oracleDeals);
  const actual = await newGame.readTeamTotals(page);
  const mismatch = actual.length !== 2 || actual[0] !== expected[0] || actual[1] !== expected[1];
  if (mismatch) {
    const summary = `Score mismatch after deal ${dealIndex}: oracle expects [${expected}], app shows [${actual}]`;
    if (logger) {
      await logger.record({
        severity: "critical",
        category: "scoring-correctness",
        summary,
        expected,
        actual,
        page,
        contextLabel,
      });
    } else {
      throw new Error(summary);
    }
  }
  return { expected, actual, mismatch };
}

async function checkWinnerAgreement(page, oracleDeals, { logger, contextLabel } = {}) {
  const detail = oracle.gameWinnerDetail(oracleDeals);
  const banner = await newGame.readWinnerBanner(page);
  const oracleThinksOver = detail.winner != null;
  const appThinksOver = !!banner;
  if (oracleThinksOver !== appThinksOver) {
    const summary = oracleThinksOver
      ? `Oracle expects team ${detail.winner} to have won, but no win banner is shown`
      : `App shows a win banner ("${banner}") but the oracle doesn't think the game is over`;
    if (logger) {
      await logger.record({
        severity: "critical",
        category: "scoring-correctness",
        summary,
        expected: detail,
        actual: banner,
        page,
        contextLabel,
      });
    } else {
      throw new Error(summary);
    }
  }
  return { detail, banner };
}

/**
 * Play an exact, caller-scripted sequence of deals (for edge cases: a
 * specific set, a moon at a specific score, a tie-break scenario, etc.),
 * cross-checking the running score against the oracle after every deal and
 * the win/no-win state at the end. `deals` entries are
 * `{ bidder: {seat} | {teamIndex}, bid, pointsTaken }`.
 */
async function playGameWithScriptedDeals(page, deals, { logger, contextLabel } = {}) {
  const oracleDeals = [];
  const results = [];
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    const bidTeam = "seat" in d.bidder ? d.bidder.seat % 2 : d.bidder.teamIndex;
    oracleDeals.push({ bidTeam, bid: d.bid, pointsTaken: d.pointsTaken });
    if (logger) logger.step(`Deal ${i + 1}: ${JSON.stringify(d.bidder)} bid ${d.bid}, took ${d.pointsTaken}`);
    const { warnings } = await handEntry.playDeal(page, d);
    results.push({ warnings });
    await crossCheck(page, oracleDeals, i + 1, { logger, contextLabel });
  }
  const winner = await checkWinnerAgreement(page, oracleDeals, { logger, contextLabel });
  return { oracleDeals, results, ...winner };
}

/**
 * Play randomized-but-legal deals until someone wins (or `maxDeals` is hit,
 * which itself is a finding -- a real game always terminates). Used to fill
 * out tournament/series matches where the exact deal sequence doesn't
 * matter, just that a lot of varied bid/set/moon combinations get exercised.
 * `bidderFor(bidTeam, dealIndex)` maps a chosen team to a concrete
 * `{seat}`/`{teamIndex}` bidder -- callers know whether the match is in
 * named-seat mode or not.
 */
async function playDealsToCompletion(page, { bidderFor, seed, maxDeals = 25, logger, contextLabel } = {}) {
  const rng = mulberry32(seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0));
  const oracleDeals = [];
  let dealIndex = 0;
  while (dealIndex < maxDeals) {
    if (oracle.gameWinner(oracleDeals) != null) break;
    dealIndex++;
    const bidTeam = rng() < 0.5 ? 0 : 1;
    const bid = oracle.MIN_BID + Math.floor(rng() * (oracle.MAX_BID - oracle.MIN_BID + 1));
    const roll = rng();
    let pointsTaken;
    if (bid === oracle.MAX_BID && roll < 0.15) {
      pointsTaken = 14; // attempt the moon
    } else if (roll < 0.7) {
      pointsTaken = bid + Math.floor(rng() * (oracle.POINTS_PER_DEAL - bid + 1)); // make the bid
    } else {
      pointsTaken = Math.max(0, bid - 1 - Math.floor(rng() * bid)); // go set
    }
    pointsTaken = Math.max(0, Math.min(oracle.POINTS_PER_DEAL, pointsTaken));

    const bidder = bidderFor(bidTeam, dealIndex);
    oracleDeals.push({ bidTeam, bid, pointsTaken });
    if (logger) logger.step(`Random deal ${dealIndex} (seed continues): team ${bidTeam} bid ${bid}, took ${pointsTaken}`);
    await handEntry.playDeal(page, { bidder, bid, pointsTaken });
    await crossCheck(page, oracleDeals, dealIndex, { logger, contextLabel });
  }
  if (oracle.gameWinner(oracleDeals) == null && logger) {
    await logger.record({
      severity: "high",
      category: "ui-stuck",
      summary: `Game didn't reach a winner within ${maxDeals} randomized deals`,
      page,
      contextLabel,
    });
  }
  const winner = await checkWinnerAgreement(page, oracleDeals, { logger, contextLabel });
  return { oracleDeals, ...winner };
}

/**
 * Play an entire bracket/round-robin/series to completion: repeatedly opens
 * the next playable match, plays it in-app with randomized-legal deals, and
 * returns to the bracket, until nothing is left to play. Works across all
 * four tournament formats since `bracket.openNextMatch`/`returnToBracket`
 * already abstract over their differing UI (`.tnext`, `.mbox.ready`,
 * `.rr-row`). Returns the number of matches played.
 */
async function playTournamentToChampion(
  page,
  { logger, contextLabel, maxMatches = 15, seedBase = 5000, dismissOffer = true } = {}
) {
  let matchesPlayed = 0;
  while (matchesPlayed < maxMatches) {
    const opened = await bracket.openNextMatch(page);
    if (!opened) break;
    await bracket.playInApp(page);
    matchesPlayed++;
    await playDealsToCompletion(page, {
      bidderFor: namedBidderFor,
      seed: seedBase + matchesPlayed,
      logger,
      contextLabel,
    });
    await bracket.returnToBracket(page);
  }
  // A clinched series (bracket-driven `returnToBracket` -> offerSeriesEscalationOnBracketClinch,
  // same as the Game tab's advanceSharedGame) auto-opens a "Play again?"/"Play
  // Best of N?" escalation offer that would otherwise block any further
  // navigation. NOTE: declining a *linked* (bracket-driven) offer calls
  // declineSeriesOffer(), which sets `tourney = null` -- i.e. it doesn't just
  // dismiss the offer, it locally leaves/clears the whole tournament (the
  // Firebase record itself is untouched, so other devices are unaffected).
  // Callers that want to inspect the decided bracket/series state afterward
  // must pass `dismissOffer:false` and handle the dialog themselves.
  if (dismissOffer) await newGame.dismissPlayAgainOffer(page);
  if (matchesPlayed >= maxMatches && logger) {
    await logger.record({
      severity: "high",
      category: "ui-stuck",
      summary: `Tournament didn't finish within ${maxMatches} matches -- openNextMatch kept finding more`,
      page,
      contextLabel,
    });
  }
  return matchesPlayed;
}

/** Default bidder-picker for named-roster play: alternates between the two seats on the bidding team. */
function namedBidderFor(bidTeam, dealIndex) {
  return { seat: bidTeam + (dealIndex % 2) * 2 };
}

/** Default bidder-picker for unnamed/team-button play. */
function teamIndexBidderFor(bidTeam) {
  return { teamIndex: bidTeam };
}

module.exports = {
  mulberry32,
  crossCheck,
  checkWinnerAgreement,
  playGameWithScriptedDeals,
  playDealsToCompletion,
  playTournamentToChampion,
  namedBidderFor,
  teamIndexBidderFor,
};
