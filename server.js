const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const players = new Map();
const invites = new Map();
const games = new Map();
const streams = new Map();

const RANK_LABELS = new Map([
  [3, "3"],
  [4, "4"],
  [5, "5"],
  [6, "6"],
  [7, "7"],
  [8, "8"],
  [9, "9"],
  [10, "10"],
  [11, "J"],
  [12, "Q"],
  [13, "K"],
  [14, "A"],
  [15, "2"],
  [16, "小王"],
  [17, "大王"]
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function now() {
  return Date.now();
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function makeDeck() {
  const suits = ["♠", "♥", "♣", "♦"];
  const deck = [];
  for (const suit of suits) {
    for (let rank = 3; rank <= 15; rank += 1) {
      deck.push({
        id: `${suit}${rank}_${crypto.randomBytes(3).toString("hex")}`,
        rank,
        suit,
        label: `${suit}${RANK_LABELS.get(rank)}`
      });
    }
  }
  deck.push({ id: `joker16_${crypto.randomBytes(3).toString("hex")}`, rank: 16, suit: "☆", label: "小王" });
  deck.push({ id: `joker17_${crypto.randomBytes(3).toString("hex")}`, rank: 17, suit: "★", label: "大王" });
  return shuffle(deck);
}

function shuffle(cards) {
  const next = cards.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function sortHand(hand) {
  hand.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  return hand;
}

function groupRanks(cards) {
  const groups = new Map();
  for (const card of cards) {
    if (!groups.has(card.rank)) groups.set(card.rank, []);
    groups.get(card.rank).push(card);
  }
  return [...groups.entries()]
    .map(([rank, grouped]) => ({ rank, count: grouped.length, cards: grouped }))
    .sort((a, b) => a.rank - b.rank);
}

function consecutive(ranks) {
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

function analyze(cards) {
  const sorted = cards.slice().sort((a, b) => a.rank - b.rank);
  const n = sorted.length;
  if (!n) return null;
  const groups = groupRanks(sorted);
  const counts = groups.map(group => group.count).sort((a, b) => a - b);
  const ranks = groups.map(group => group.rank);

  if (n === 2 && ranks.includes(16) && ranks.includes(17)) {
    return { type: "rocket", weight: 99, length: n, label: "王炸" };
  }
  if (n === 4 && groups.length === 1) {
    return { type: "bomb", weight: ranks[0], length: n, label: "炸弹" };
  }
  if (n === 1) return { type: "single", weight: ranks[0], length: n, label: "单张" };
  if (n === 2 && groups.length === 1) return { type: "pair", weight: ranks[0], length: n, label: "对子" };
  if (n === 3 && groups.length === 1) return { type: "triple", weight: ranks[0], length: n, label: "三张" };
  if (n === 4 && counts.join(",") === "1,3") {
    return { type: "triple_single", weight: groups.find(group => group.count === 3).rank, length: n, label: "三带一" };
  }
  if (n === 5 && counts.join(",") === "2,3") {
    return { type: "triple_pair", weight: groups.find(group => group.count === 3).rank, length: n, label: "三带一对" };
  }
  if (n >= 5 && groups.every(group => group.count === 1) && ranks.every(rank => rank <= 14) && consecutive(ranks)) {
    return { type: "straight", weight: ranks.at(-1), length: n, label: "顺子" };
  }
  if (n >= 6 && n % 2 === 0 && groups.every(group => group.count === 2) && ranks.every(rank => rank <= 14) && consecutive(ranks)) {
    return { type: "pair_straight", weight: ranks.at(-1), length: n, label: "连对" };
  }
  if (n === 6 && counts.join(",") === "1,1,4") {
    return { type: "four_two", weight: groups.find(group => group.count === 4).rank, length: n, label: "四带二" };
  }
  if (n === 8 && counts.join(",") === "2,2,4") {
    return { type: "four_two_pairs", weight: groups.find(group => group.count === 4).rank, length: n, label: "四带两对" };
  }

  const triples = groups.filter(group => group.count === 3 && group.rank <= 14);
  if (triples.length >= 2 && consecutive(triples.map(group => group.rank))) {
    const wings = n - triples.length * 3;
    if (wings === 0 || wings === triples.length || wings === triples.length * 2) {
      if (wings === triples.length * 2) {
        const pairedWings = groups.filter(group => group.count === 2).length;
        if (pairedWings !== triples.length) return null;
      }
      return {
        type: wings === 0 ? "airplane" : wings === triples.length ? "airplane_single" : "airplane_pair",
        weight: triples.at(-1).rank,
        length: n,
        tripleCount: triples.length,
        label: "飞机"
      };
    }
  }

  return null;
}

function canBeat(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate.type === "rocket") return current.type !== "rocket";
  if (current.type === "rocket") return false;
  if (candidate.type === "bomb" && current.type !== "bomb") return true;
  if (current.type === "bomb" && candidate.type !== "bomb") return false;
  return candidate.type === current.type && candidate.length === current.length && candidate.weight > current.weight;
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    online: player.online,
    isAi: player.isAi,
    gameId: player.gameId || null,
    lastSeen: player.lastSeen
  };
}

function handScore(hand) {
  return hand.reduce((score, card) => score + Math.max(0, card.rank - 10), 0);
}

function createGame(humanPlayers, mode) {
  const aiNeeded = 3 - humanPlayers.length;
  const seats = humanPlayers.map(player => player.id);
  for (let i = 0; i < aiNeeded; i += 1) {
    const ai = {
      id: id("ai"),
      name: i === 0 ? "灵犀电脑" : "星河电脑",
      isAi: true,
      online: true,
      lastSeen: now()
    };
    players.set(ai.id, ai);
    seats.push(ai.id);
  }

  const deck = makeDeck();
  const hands = {};
  for (const seat of seats) hands[seat] = sortHand(deck.splice(0, 17));
  const bottom = sortHand(deck.splice(0, 3));
  const game = {
    id: id("game"),
    mode,
    seats,
    hands,
    bottom,
    phase: "bidding",
    bidTurn: seats[0],
    passedBids: [],
    landlord: null,
    turn: null,
    currentPlay: null,
    lastMove: null,
    history: [],
    winner: null,
    finished: false,
    createdAt: now()
  };

  games.set(game.id, game);
  for (const seat of seats) {
    const player = players.get(seat);
    if (player) player.gameId = game.id;
  }
  notifyGame(game);
  maybeAutoPlay(game);
  return game;
}

function startLandlord(game, playerId) {
  game.landlord = playerId;
  game.hands[playerId] = sortHand(game.hands[playerId].concat(game.bottom));
  game.phase = "playing";
  game.turn = playerId;
  game.bidTurn = null;
  game.lastMove = {
    by: playerId,
    action: "landlord",
    text: `${players.get(playerId)?.name || "玩家"} 成为地主`,
    at: now()
  };
}

function nextSeat(game, playerId) {
  const index = game.seats.indexOf(playerId);
  return game.seats[(index + 1) % game.seats.length];
}

function handleBid(game, playerId, call) {
  if (game.phase !== "bidding" || game.bidTurn !== playerId) {
    throw new Error("还没轮到你叫地主");
  }
  if (call) {
    startLandlord(game, playerId);
  } else {
    game.passedBids.push(playerId);
    game.lastMove = {
      by: playerId,
      action: "bid_pass",
      text: `${players.get(playerId)?.name || "玩家"} 不叫`,
      at: now()
    };
    if (game.passedBids.length >= game.seats.length) {
      startLandlord(game, game.seats[0]);
    } else {
      game.bidTurn = nextSeat(game, playerId);
    }
  }
  notifyGame(game);
  maybeAutoPlay(game);
}

function removeCards(hand, cardIds) {
  const wanted = new Set(cardIds);
  const selected = [];
  const rest = [];
  for (const card of hand) {
    if (wanted.has(card.id)) selected.push(card);
    else rest.push(card);
  }
  if (selected.length !== wanted.size) throw new Error("选中的牌不在手牌中");
  return { selected, rest };
}

function handlePlay(game, playerId, cardIds) {
  if (game.phase !== "playing" || game.turn !== playerId || game.finished) {
    throw new Error("还没轮到你出牌");
  }
  const { selected, rest } = removeCards(game.hands[playerId], cardIds);
  const pattern = analyze(selected);
  const activeCurrent = game.currentPlay && game.currentPlay.by !== playerId ? game.currentPlay : null;
  if (!pattern) throw new Error("牌型不支持");
  if (!canBeat(pattern, activeCurrent?.pattern || null)) throw new Error("压不过上家");

  game.hands[playerId] = sortHand(rest);
  game.currentPlay = {
    by: playerId,
    cards: selected.slice().sort((a, b) => a.rank - b.rank),
    pattern,
    at: now()
  };
  game.lastMove = {
    by: playerId,
    action: "play",
    text: `${players.get(playerId)?.name || "玩家"} 打出 ${pattern.label}`,
    at: now()
  };
  game.history.push(game.currentPlay);

  if (game.hands[playerId].length === 0) {
    const landlordWon = playerId === game.landlord;
    game.finished = true;
    game.phase = "finished";
    game.winner = landlordWon ? "landlord" : "farmers";
    game.lastMove = {
      by: playerId,
      action: "win",
      text: landlordWon ? "地主获胜" : "农民获胜",
      at: now()
    };
  } else {
    game.turn = nextSeat(game, playerId);
  }
  notifyGame(game);
  maybeAutoPlay(game);
}

function handlePass(game, playerId) {
  if (game.phase !== "playing" || game.turn !== playerId || game.finished) {
    throw new Error("还没轮到你操作");
  }
  if (!game.currentPlay || game.currentPlay.by === playerId) {
    throw new Error("你当前需要出牌");
  }
  game.lastMove = {
    by: playerId,
    action: "pass",
    text: `${players.get(playerId)?.name || "玩家"} 不要`,
    at: now()
  };
  const next = nextSeat(game, playerId);
  if (game.currentPlay.by === next) {
    game.currentPlay = null;
  }
  game.turn = next;
  notifyGame(game);
  maybeAutoPlay(game);
}

function pickSmallestOpening(hand) {
  const groups = groupRanks(hand);
  const single = groups.find(group => group.count === 1 && group.rank < 16) || groups[0];
  return [single.cards[0].id];
}

function pickBeat(hand, current) {
  const groups = groupRanks(hand);
  const makeIds = cards => cards.map(card => card.id);
  const higher = groups.filter(group => group.rank > current.weight);

  if (current.type === "single") {
    const group = higher.find(item => item.count >= 1);
    if (group) return makeIds(group.cards.slice(0, 1));
  }
  if (current.type === "pair") {
    const group = higher.find(item => item.count >= 2);
    if (group) return makeIds(group.cards.slice(0, 2));
  }
  if (current.type === "triple") {
    const group = higher.find(item => item.count >= 3);
    if (group) return makeIds(group.cards.slice(0, 3));
  }
  if (current.type === "triple_single") {
    const triple = higher.find(item => item.count >= 3);
    const wing = groups.find(item => item.rank !== triple?.rank);
    if (triple && wing) return makeIds(triple.cards.slice(0, 3).concat(wing.cards.slice(0, 1)));
  }
  if (current.type === "triple_pair") {
    const triple = higher.find(item => item.count >= 3);
    const wing = groups.find(item => item.rank !== triple?.rank && item.count >= 2);
    if (triple && wing) return makeIds(triple.cards.slice(0, 3).concat(wing.cards.slice(0, 2)));
  }
  if (current.type === "bomb") {
    const bomb = higher.find(item => item.count === 4);
    if (bomb) return makeIds(bomb.cards);
  }

  const bomb = groups.find(item => item.count === 4);
  if (bomb && current.type !== "rocket") return makeIds(bomb.cards);
  const hasSmallJoker = groups.find(item => item.rank === 16);
  const hasBigJoker = groups.find(item => item.rank === 17);
  if (hasSmallJoker && hasBigJoker) return makeIds([hasSmallJoker.cards[0], hasBigJoker.cards[0]]);
  return [];
}

function maybeAutoPlay(game) {
  if (game.finished) return;
  const turn = game.phase === "bidding" ? game.bidTurn : game.turn;
  const player = players.get(turn);
  if (!player?.isAi || game.aiTimer) return;

  game.aiTimer = setTimeout(() => {
    game.aiTimer = null;
    try {
      if (game.phase === "bidding") {
        const call = handScore(game.hands[player.id]) >= 28 || game.passedBids.length === 2;
        handleBid(game, player.id, call);
        return;
      }
      const current = game.currentPlay?.by === player.id ? null : game.currentPlay?.pattern;
      const cardIds = current ? pickBeat(game.hands[player.id], current) : pickSmallestOpening(game.hands[player.id]);
      if (cardIds.length) handlePlay(game, player.id, cardIds);
      else handlePass(game, player.id);
    } catch (error) {
      console.error("AI action failed:", error);
    }
  }, 850);
}

function cardView(card) {
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    label: card.label,
    red: card.suit === "♥" || card.suit === "♦" || card.rank >= 16
  };
}

function gameView(game, viewerId) {
  return {
    id: game.id,
    mode: game.mode,
    phase: game.phase,
    seats: game.seats.map(seat => {
      const player = players.get(seat);
      return {
        id: seat,
        name: player?.name || "玩家",
        isAi: Boolean(player?.isAi),
        handCount: game.hands[seat]?.length || 0,
        role: game.landlord ? (seat === game.landlord ? "地主" : "农民") : "待叫",
        isTurn: (game.phase === "bidding" ? game.bidTurn : game.turn) === seat
      };
    }),
    landlord: game.landlord,
    turn: game.phase === "bidding" ? game.bidTurn : game.turn,
    bottom: game.landlord ? game.bottom.map(cardView) : game.bottom.map(() => ({ label: "牌背" })),
    hand: (game.hands[viewerId] || []).map(cardView),
    currentPlay: game.currentPlay
      ? {
          by: game.currentPlay.by,
          byName: players.get(game.currentPlay.by)?.name || "玩家",
          cards: game.currentPlay.cards.map(cardView),
          pattern: game.currentPlay.pattern
        }
      : null,
    lastMove: game.lastMove,
    winner: game.winner,
    finished: game.finished
  };
}

function stateFor(playerId) {
  const player = players.get(playerId);
  const game = player?.gameId ? games.get(player.gameId) : null;
  return {
    you: player ? publicPlayer(player) : null,
    onlineCount: [...players.values()].filter(item => item.online && !item.isAi).length,
    players: [...players.values()]
      .filter(item => item.online && !item.isAi && item.id !== playerId)
      .map(publicPlayer),
    incoming: [...invites.values()].filter(invite => invite.to === playerId && invite.status === "pending"),
    outgoing: [...invites.values()].filter(invite => invite.from === playerId && invite.status === "pending"),
    game: game ? gameView(game, playerId) : null
  };
}

function sendState(playerId) {
  const stream = streams.get(playerId);
  if (!stream) return;
  stream.write(`event: state\ndata: ${JSON.stringify(stateFor(playerId))}\n\n`);
}

function broadcastAll() {
  for (const playerId of streams.keys()) sendState(playerId);
}

function notifyGame(game) {
  for (const seat of game.seats) sendState(seat);
  broadcastAll();
}

function cleanupInvites() {
  const cutoff = now() - 1000 * 60 * 5;
  for (const [inviteId, invite] of invites) {
    if (invite.createdAt < cutoff || invite.status !== "pending") invites.delete(inviteId);
  }
}

function safeName(name) {
  return String(name || "").trim().slice(0, 14) || `玩家${crypto.randomInt(1000, 9999)}`;
}

async function routeApi(req, res, url) {
  const body = req.method === "POST" ? await readBody(req) : {};

  if (req.method === "GET" && url.pathname === "/api/config") {
    return json(res, 200, { name: "斗地主", domain: "ddz.lure.red" });
  }

  if (req.method === "POST" && url.pathname === "/api/join") {
    const existing = body.playerId && players.get(body.playerId);
    const player = existing || {
      id: id("player"),
      isAi: false
    };
    player.name = safeName(body.name || player.name);
    player.online = true;
    player.lastSeen = now();
    players.set(player.id, player);
    broadcastAll();
    return json(res, 200, { player: publicPlayer(player), state: stateFor(player.id) });
  }

  if (req.method === "POST" && url.pathname === "/api/leave") {
    const player = players.get(body.playerId);
    if (player) {
      player.online = false;
      player.lastSeen = now();
      streams.delete(player.id);
    }
    broadcastAll();
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    return json(res, 200, stateFor(url.searchParams.get("playerId")));
  }

  if (req.method === "POST" && url.pathname === "/api/computer/start") {
    const player = players.get(body.playerId);
    if (!player) return json(res, 404, { error: "请先进入大厅" });
    if (player.gameId && games.get(player.gameId) && !games.get(player.gameId).finished) {
      return json(res, 409, { error: "你已经在牌局中" });
    }
    const game = createGame([player], "computer");
    return json(res, 200, { game: gameView(game, player.id) });
  }

  if (req.method === "POST" && url.pathname === "/api/invite") {
    const from = players.get(body.from);
    const to = players.get(body.to);
    if (!from || !to || to.isAi || !to.online) return json(res, 404, { error: "玩家不在线" });
    if (from.gameId && games.get(from.gameId) && !games.get(from.gameId).finished) {
      return json(res, 409, { error: "你已经在牌局中" });
    }
    const invite = {
      id: id("invite"),
      from: from.id,
      fromName: from.name,
      to: to.id,
      toName: to.name,
      status: "pending",
      createdAt: now()
    };
    invites.set(invite.id, invite);
    broadcastAll();
    return json(res, 200, { invite });
  }

  if (req.method === "POST" && url.pathname === "/api/invite/respond") {
    const invite = invites.get(body.inviteId);
    if (!invite || invite.to !== body.playerId || invite.status !== "pending") {
      return json(res, 404, { error: "邀请不存在" });
    }
    invite.status = body.accept ? "accepted" : "declined";
    let game = null;
    if (body.accept) {
      const from = players.get(invite.from);
      const to = players.get(invite.to);
      if (!from || !to) return json(res, 404, { error: "玩家已离线" });
      if ((from.gameId && games.get(from.gameId) && !games.get(from.gameId).finished) || (to.gameId && games.get(to.gameId) && !games.get(to.gameId).finished)) {
        return json(res, 409, { error: "有玩家已经在牌局中" });
      }
      game = createGame([from, to], "online");
    }
    broadcastAll();
    return json(res, 200, { invite, game: game ? gameView(game, body.playerId) : null });
  }

  const bidMatch = url.pathname.match(/^\/api\/game\/([^/]+)\/bid$/);
  if (req.method === "POST" && bidMatch) {
    const game = games.get(bidMatch[1]);
    if (!game) return json(res, 404, { error: "牌局不存在" });
    try {
      handleBid(game, body.playerId, Boolean(body.call));
      return json(res, 200, { game: gameView(game, body.playerId) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const playMatch = url.pathname.match(/^\/api\/game\/([^/]+)\/play$/);
  if (req.method === "POST" && playMatch) {
    const game = games.get(playMatch[1]);
    if (!game) return json(res, 404, { error: "牌局不存在" });
    try {
      handlePlay(game, body.playerId, body.cardIds || []);
      return json(res, 200, { game: gameView(game, body.playerId) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const passMatch = url.pathname.match(/^\/api\/game\/([^/]+)\/pass$/);
  if (req.method === "POST" && passMatch) {
    const game = games.get(passMatch[1]);
    if (!game) return json(res, 404, { error: "牌局不存在" });
    try {
      handlePass(game, body.playerId);
      return json(res, 200, { game: gameView(game, body.playerId) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const exitMatch = url.pathname.match(/^\/api\/game\/([^/]+)\/exit$/);
  if (req.method === "POST" && exitMatch) {
    const game = games.get(exitMatch[1]);
    if (game) {
      for (const seat of game.seats) {
        const player = players.get(seat);
        if (player) player.gameId = null;
      }
      game.finished = true;
      game.phase = "finished";
      notifyGame(game);
    }
    broadcastAll();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/events") {
    const playerId = url.searchParams.get("playerId");
    if (!players.has(playerId)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    streams.set(playerId, res);
    sendState(playerId);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      streams.delete(playerId);
    });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    try {
      cleanupInvites();
      return await routeApi(req, res, url);
    } catch (error) {
      console.error(error);
      return json(res, 400, { error: "请求格式错误" });
    }
  }

  return serveStatic(req, res, url);
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`斗地主 running at http://${HOST}:${PORT}`);
  });
}

module.exports = {
  analyze,
  canBeat,
  server
};
