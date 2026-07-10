"use strict";
// Independent reimplementation of Some-R-Set's scoring rules, deliberately
// NOT derived from reading index.html's implementation -- this is the
// cross-check oracle, so it must encode the *documented* rules (README.md +
// the in-app copy players see) rather than mirror whatever the app happens
// to compute. Any divergence between this and the rendered app is a finding.
//
// Rules encoded:
//  - POINTS_PER_DEAL = 14, split entirely between the two teams each deal.
//  - Bid range 6-14.
//  - If the bidding team's points taken >= its bid, both teams score the
//    points they actually took.
//  - Otherwise the bidding team is "set": it loses its bid (subtracted from
//    its score, which can go negative); the other team still scores what it
//    took.
//  - Shooting the moon: bid===14 and pointsTaken===14 jumps the bidding
//    team straight to exactly 50 -- but only if its score was >= 0 *before*
//    the hand. If it was negative, the moon is scored as ordinary points
//    (no auto-win).
//  - A game cannot end in an exact tie: if both teams are >= target after
//    the same deal with equal scores, the team that bid on that deal wins
//    (README/in-app rule: "they took the risk").
//  - Dealer rotates one seat clockwise (0->1->2->3->0) every deal.

const POINTS_PER_DEAL = 14;
const TARGET = 50;
const MIN_BID = 6;
const MAX_BID = 14;

function isValidBid(bid) {
  return Number.isInteger(bid) && bid >= MIN_BID && bid <= MAX_BID;
}

function isMoonAttempt(deal) {
  return deal.bid === POINTS_PER_DEAL && deal.pointsTaken === POINTS_PER_DEAL;
}

function isSet(deal) {
  return deal.pointsTaken < deal.bid;
}

/** [deltaTeam0, deltaTeam1] for one deal, given pre-hand scores [s0, s1]. */
function dealDelta(deal, preScores) {
  const { bidTeam, bid, pointsTaken } = deal;
  const otherTeam = 1 - bidTeam;
  const otherPointsTaken = POINTS_PER_DEAL - pointsTaken;
  const delta = [0, 0];

  if (isMoonAttempt(deal) && preScores[bidTeam] >= 0) {
    delta[bidTeam] = TARGET - preScores[bidTeam];
    delta[otherTeam] = otherPointsTaken; // will be 0 for a true moon, kept general
    return delta;
  }
  if (pointsTaken >= bid) {
    delta[bidTeam] = pointsTaken;
    delta[otherTeam] = otherPointsTaken;
  } else {
    delta[bidTeam] = -bid;
    delta[otherTeam] = otherPointsTaken;
  }
  return delta;
}

/** Running score after each deal: [[s0,s1] after deal 0, after deal 1, ...] */
function runningTotals(deals) {
  const out = [];
  let s = [0, 0];
  for (const d of deals) {
    const delta = dealDelta(d, s);
    s = [s[0] + delta[0], s[1] + delta[1]];
    out.push(s);
  }
  return out;
}

function finalTotals(deals) {
  const rt = runningTotals(deals);
  return rt.length ? rt[rt.length - 1] : [0, 0];
}

/**
 * { winner: 0|1|null, tieBreak: bool, moonWin: bool }
 * Mirrors the documented "no ties -- the bidder on the tying deal wins" rule.
 */
function gameWinnerDetail(deals) {
  let s = [0, 0];
  let lastBidTeam = null;
  for (const d of deals) {
    const delta = dealDelta(d, s);
    s = [s[0] + delta[0], s[1] + delta[1]];
    lastBidTeam = d.bidTeam;
    if (isMoonAttempt(d) && s[d.bidTeam] >= TARGET) {
      return { winner: d.bidTeam, tieBreak: false, moonWin: true };
    }
  }
  if (s[0] < TARGET && s[1] < TARGET) return { winner: null, tieBreak: false, moonWin: false };
  if (s[0] === s[1]) return { winner: lastBidTeam, tieBreak: true, moonWin: false };
  return { winner: s[0] > s[1] ? 0 : 1, tieBreak: false, moonWin: false };
}

function gameWinner(deals) {
  return gameWinnerDetail(deals).winner;
}

function dealerForDeal(dealerStartSeat, dealIndexZeroBased) {
  return (dealerStartSeat + dealIndexZeroBased) % 4;
}

module.exports = {
  POINTS_PER_DEAL,
  TARGET,
  MIN_BID,
  MAX_BID,
  isValidBid,
  isMoonAttempt,
  isSet,
  dealDelta,
  runningTotals,
  finalTotals,
  gameWinnerDetail,
  gameWinner,
  dealerForDeal,
};
