const app = document.querySelector("#app");
const saved = {
  id: localStorage.getItem("ddz.playerId"),
  name: localStorage.getItem("ddz.name") || ""
};

let state = null;
let selected = new Set();
let source = null;

const rankWeight = card => card.rank * 10 + (card.suit || "").charCodeAt(0);

function h(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

function isRed(card) {
  return card.red ? " red" : "";
}

function connectEvents(playerId) {
  if (source) source.close();
  source = new EventSource(`/events?playerId=${encodeURIComponent(playerId)}`);
  source.addEventListener("state", event => {
    state = JSON.parse(event.data);
    render();
  });
  source.onerror = () => {
    setTimeout(() => {
      if (state?.you?.id) connectEvents(state.you.id);
    }, 1500);
  };
}

async function join(name) {
  const data = await api("/api/join", { name, playerId: saved.id });
  localStorage.setItem("ddz.playerId", data.player.id);
  localStorage.setItem("ddz.name", data.player.name);
  state = data.state;
  connectEvents(data.player.id);
  render();
}

function renderJoin() {
  app.innerHTML = `
    <section class="join-screen">
      <div class="brand-lockup">
        <div class="chip">实时对战</div>
        <h1>斗地主</h1>
        <p>好友邀请、在线开桌、AI 陪练，一进来就能打。</p>
      </div>
      <form class="join-box" id="joinForm">
        <input id="nameInput" maxlength="14" autocomplete="nickname" placeholder="输入昵称" value="${h(saved.name)}" />
        <button type="submit">进入牌桌</button>
      </form>
    </section>
  `;
  document.querySelector("#joinForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = document.querySelector("#nameInput").value.trim();
    join(name).catch(error => toast(error.message));
  });
}

function renderLobby() {
  const you = state.you;
  const game = state.game;
  const incoming = state.incoming.map(invite => `
    <div class="invite">
      <span>${h(invite.fromName)} 邀请你对战</span>
      <div class="mini-actions">
        <button data-accept="${invite.id}">接受</button>
        <button class="ghost" data-decline="${invite.id}">拒绝</button>
      </div>
    </div>
  `).join("");
  const players = state.players.map(player => `
    <li>
      <span class="avatar">${h(player.name.slice(0, 1).toUpperCase())}</span>
      <span class="player-name">${h(player.name)}</span>
      <span class="status-dot ${player.gameId ? "busy" : ""}"></span>
      <button data-invite="${player.id}" ${player.gameId ? "disabled" : ""}>邀请</button>
    </li>
  `).join("");

  return `
    <aside class="lobby">
      <div class="profile">
        <span class="avatar large">${h(you.name.slice(0, 1).toUpperCase())}</span>
        <div>
          <strong>${h(you.name)}</strong>
          <small>在线 ${state.onlineCount} 人</small>
        </div>
      </div>
      <button class="primary" id="aiStart">AI 电脑模式</button>
      ${incoming ? `<div class="panel-title">邀请</div>${incoming}` : ""}
      <div class="panel-title">在线玩家</div>
      <ul class="player-list">${players || `<li class="empty">暂无其他玩家在线</li>`}</ul>
      ${game ? `<button class="ghost full" id="exitGame">返回大厅</button>` : ""}
    </aside>
  `;
}

function seatMarkup(seat) {
  return `
    <div class="seat ${seat.isTurn ? "active" : ""}">
      <div class="avatar">${h(seat.name.slice(0, 1).toUpperCase())}</div>
      <div>
        <strong>${h(seat.name)}</strong>
        <small>${seat.role} · ${seat.handCount} 张</small>
      </div>
    </div>
  `;
}

function cardMarkup(card, selectable = false) {
  const chosen = selected.has(card.id) ? " selected" : "";
  return `
    <button class="card${isRed(card)}${chosen}" ${selectable ? `data-card="${card.id}"` : ""}>
      <span>${h(card.label)}</span>
      <b>${h(card.suit && card.rank < 16 ? card.suit : "")}</b>
    </button>
  `;
}

function renderTable() {
  const game = state.game;
  if (!game) {
    return `
      <section class="table idle">
        <div class="table-felt">
          <h2>大厅</h2>
          <p>选择 AI 电脑模式，或从左侧邀请在线玩家开一桌。</p>
          <div class="deck-art">
            <span>J</span><span>Q</span><span>K</span><span>A</span><span>王</span>
          </div>
        </div>
      </section>
    `;
  }

  const others = game.seats.filter(seat => seat.id !== state.you.id);
  const yourTurn = game.turn === state.you.id;
  const bidControls = game.phase === "bidding" && yourTurn
    ? `<div class="actions"><button id="callLandlord">叫地主</button><button class="ghost" id="passBid">不叫</button></div>`
    : "";
  const playControls = game.phase === "playing" && yourTurn
    ? `<div class="actions"><button id="playCards">出牌</button><button class="ghost" id="passCards">不要</button></div>`
    : "";
  const finishedControls = game.finished
    ? `<div class="actions"><button id="newAi">再来一局</button><button class="ghost" id="exitGame2">回大厅</button></div>`
    : "";
  const current = game.currentPlay
    ? `
      <div class="played">
        <small>${h(game.currentPlay.byName)} · ${h(game.currentPlay.pattern.label)}</small>
        <div class="played-cards">${game.currentPlay.cards.map(card => cardMarkup(card)).join("")}</div>
      </div>
    `
    : `<div class="played muted">等待出牌</div>`;

  return `
    <section class="table">
      <div class="opponents">${others.map(seatMarkup).join("")}</div>
      <div class="table-felt">
        <div class="bottom-cards">${game.bottom.map(card => cardMarkup(card)).join("")}</div>
        ${current}
        <div class="move-line">${h(game.lastMove?.text || "牌局开始")}</div>
        ${bidControls || playControls || finishedControls}
      </div>
      <div class="self-area">
        ${seatMarkup(game.seats.find(seat => seat.id === state.you.id))}
        <div class="hand">${game.hand.sort((a, b) => rankWeight(a) - rankWeight(b)).map(card => cardMarkup(card, game.phase === "playing" && yourTurn)).join("")}</div>
      </div>
    </section>
  `;
}

function bind() {
  document.querySelector("#aiStart")?.addEventListener("click", () => {
    selected.clear();
    api("/api/computer/start", { playerId: state.you.id }).catch(error => toast(error.message));
  });
  document.querySelector("#newAi")?.addEventListener("click", () => {
    selected.clear();
    api("/api/computer/start", { playerId: state.you.id }).catch(error => toast(error.message));
  });
  document.querySelectorAll("[data-invite]").forEach(button => {
    button.addEventListener("click", () => {
      api("/api/invite", { from: state.you.id, to: button.dataset.invite })
        .then(() => toast("邀请已发送"))
        .catch(error => toast(error.message));
    });
  });
  document.querySelectorAll("[data-accept]").forEach(button => {
    button.addEventListener("click", () => {
      selected.clear();
      api("/api/invite/respond", { playerId: state.you.id, inviteId: button.dataset.accept, accept: true })
        .catch(error => toast(error.message));
    });
  });
  document.querySelectorAll("[data-decline]").forEach(button => {
    button.addEventListener("click", () => {
      api("/api/invite/respond", { playerId: state.you.id, inviteId: button.dataset.decline, accept: false })
        .catch(error => toast(error.message));
    });
  });
  document.querySelector("#callLandlord")?.addEventListener("click", () => {
    api(`/api/game/${state.game.id}/bid`, { playerId: state.you.id, call: true }).catch(error => toast(error.message));
  });
  document.querySelector("#passBid")?.addEventListener("click", () => {
    api(`/api/game/${state.game.id}/bid`, { playerId: state.you.id, call: false }).catch(error => toast(error.message));
  });
  document.querySelectorAll("[data-card]").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.dataset.card;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      render();
    });
  });
  document.querySelector("#playCards")?.addEventListener("click", () => {
    api(`/api/game/${state.game.id}/play`, { playerId: state.you.id, cardIds: [...selected] })
      .then(() => selected.clear())
      .catch(error => toast(error.message));
  });
  document.querySelector("#passCards")?.addEventListener("click", () => {
    selected.clear();
    api(`/api/game/${state.game.id}/pass`, { playerId: state.you.id }).catch(error => toast(error.message));
  });
  document.querySelector("#exitGame")?.addEventListener("click", exitGame);
  document.querySelector("#exitGame2")?.addEventListener("click", exitGame);
}

function exitGame() {
  if (!state.game) return;
  selected.clear();
  api(`/api/game/${state.game.id}/exit`, { playerId: state.you.id }).catch(error => toast(error.message));
}

function render() {
  if (!state?.you) {
    renderJoin();
    return;
  }
  app.innerHTML = `
    <div class="shell">
      ${renderLobby()}
      ${renderTable()}
    </div>
  `;
  bind();
}

window.addEventListener("beforeunload", () => {
  const playerId = state?.you?.id || localStorage.getItem("ddz.playerId");
  if (playerId) {
    navigator.sendBeacon("/api/leave", new Blob([JSON.stringify({ playerId })], { type: "application/json" }));
  }
});

if (saved.id) {
  join(saved.name).catch(() => renderJoin());
} else {
  renderJoin();
}
