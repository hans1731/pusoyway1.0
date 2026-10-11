const SUITS = ["S", "H", "D", "C"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const VALUES = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

function createDeck() {
  return SUITS.flatMap(s => RANKS.map(r => `${r}${s}`));
}
function shuffle(deck) {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function parseCard(card) {
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);
  return { suit, rank, value: VALUES[rank] || 0 };
}
function evaluateHand(cards) {
  const parsed = cards.map(parseCard);
  const values = parsed.map(c => c.value).sort((a,b) => b-a);
  const counts = {};
  parsed.forEach(c => counts[c.value] = (counts[c.value] || 0) + 1);
  const groups = Object.entries(counts).map(([v, n]) => ({ value: Number(v), count: n }))
    .sort((a,b) => b.count-a.count || b.value-a.value);
  const flush = parsed.length >= 5 && parsed.every(c => c.suit === parsed[0].suit);
  let unique = [...new Set(values)].sort((a,b) => b-a);
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straightHigh = unique[0];
    else if (unique.join(",") === "14,5,4,3,2") straightHigh = 5;
  }
  let category = 0, kickers = values;
  if (cards.length === 3) {
    if (groups[0].count === 3) { category = 3; kickers = [groups[0].value]; }
    else if (groups[0].count === 2) { category = 1; kickers = [groups[0].value, ...values.filter(v => v !== groups[0].value)]; }
    else { category = 0; kickers = values; }
    return { category, kickers };
  }
  if (straightHigh && flush) { category = 8; kickers = [straightHigh]; }
  else if (groups[0].count === 4) { category = 7; kickers = [groups[0].value, ...values.filter(v => v !== groups[0].value)]; }
  else if (groups[0].count === 3 && groups[1]?.count === 2) { category = 6; kickers = [groups[0].value, groups[1].value]; }
  else if (flush) { category = 5; kickers = values; }
  else if (straightHigh) { category = 4; kickers = [straightHigh]; }
  else if (groups[0].count === 3) { category = 3; kickers = [groups[0].value, ...values.filter(v => v !== groups[0].value)]; }
  else if (groups[0].count === 2 && groups[1]?.count === 2) {
    category = 2;
    const pairs = groups.filter(g => g.count === 2).map(g => g.value).sort((a,b) => b-a);
    kickers = [...pairs, ...values.filter(v => !pairs.includes(v))];
  } else if (groups[0].count === 2) { category = 1; kickers = [groups[0].value, ...values.filter(v => v !== groups[0].value)]; }
  else { category = 0; kickers = values; }
  return { category, kickers };
}
function compareHands(a, b) {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  const len = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < len; i++) {
    const av = a.kickers[i] || 0, bv = b.kickers[i] || 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}
function isFoul(front, middle, back) {
  // Basic Pusoy order: middle must be at least as strong as front; back at least as strong as middle.
  return compareHands(evaluateHand(front), evaluateHand(middle)) > 0 ||
         compareHands(evaluateHand(middle), evaluateHand(back)) > 0;
}
function chooseAceOfDiamondsDealer(players, deck) {
  // The deck is shuffled, but a player's actual hand is assigned by the server after this call.
  // The server resolves the Ace of Diamonds after dealing; fallback is first seat.
  const holder = players.find(p => (p.hand || []).includes("AD"));
  return holder || players[0] || null;
}
module.exports = { createDeck, shuffle, evaluateHand, compareHands, isFoul, chooseAceOfDiamondsDealer };
