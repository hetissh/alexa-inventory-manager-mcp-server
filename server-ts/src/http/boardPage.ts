// The live-board page: a static shell, a stylesheet and a script served by the board server.
// The script only ever puts server data on the page with `textContent`, never as HTML, and is written
// in plain ES2017 so older Fire TV web views can run it. It never blanks the screen: if the server
// cannot be reached it keeps showing the last good board and says how old it is.

/** The HTML shell. `workspaceId` has already been validated as a slug, so it is safe in an attribute. */
export function boardHtml(workspaceId: string, pollMs: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VoiceOps board</title>
<link rel="stylesheet" href="/board/assets/board.css">
</head>
<body>
<main id="board" data-workspace="${workspaceId}" data-poll-ms="${String(pollMs)}">
<header>
<h1 id="title">VoiceOps</h1>
<p id="status" class="status" role="status">Connecting…</p>
</header>
<section id="metrics" class="metrics" aria-label="Headline numbers"></section>
<section id="alerts" class="alerts" aria-label="Alerts" hidden></section>
<div id="resources"></div>
<section id="activity" class="activity" aria-label="Latest changes" hidden>
<h2>Latest changes</h2>
<ul id="activity-list" class="rows"></ul>
</section>
</main>
<script src="/board/assets/board.js" defer></script>
</body>
</html>
`;
}

export const BOARD_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html { font-size: clamp(18px, 2vw, 36px); }
body { margin: 0; background: #0b1220; color: #f4f6fb; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.3; }
main { padding: 1.2rem 1.6rem 2rem; max-width: 80rem; margin: 0 auto; }
header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.5rem 1.5rem; margin-bottom: 1rem; }
h1 { margin: 0; font-size: 2rem; }
h2 { margin: 1.4rem 0 0.5rem; font-size: 1.1rem; letter-spacing: 0.06em; text-transform: uppercase; color: #aab4c8; }
.status { margin: 0; padding: 0.2rem 0.7rem; border-radius: 0.4rem; font-size: 0.9rem; background: #12301f; color: #9df0bf; }
.status.stale { background: #4a3a0a; color: #ffd98a; }
.status.error { background: #4a1414; color: #ffb4b4; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.8rem; }
.metric { background: #16203a; border-radius: 0.6rem; padding: 0.8rem 1rem; }
.metric .value { font-size: 2.6rem; font-weight: 700; line-height: 1; }
.metric .label { margin-top: 0.3rem; color: #aab4c8; }
.alerts { margin-top: 1rem; display: grid; gap: 0.5rem; }
.alert-banner { background: #5b1d1d; border-left: 0.4rem solid #ff6b6b; border-radius: 0.4rem; padding: 0.6rem 0.9rem; font-weight: 600; }
.rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
.row { display: grid; grid-template-columns: 1.6fr 1.4fr auto; gap: 0.8rem; align-items: center; background: #121b30; border-radius: 0.5rem; padding: 0.55rem 0.9rem; }
.row .name { font-weight: 600; }
.row .detail { color: #c4cce0; }
.chip { justify-self: end; padding: 0.1rem 0.7rem; border-radius: 999px; background: #1d3a2b; color: #9df0bf; font-size: 0.85rem; white-space: nowrap; }
.row.alert { outline: 0.18rem solid #ff6b6b; background: #2a1620; }
.row.alert .chip { background: #5b1d1d; color: #ffd0d0; }
.row.down .chip { background: #4a3a0a; color: #ffd98a; }
.row.soldout .name { text-decoration: line-through; color: #8893ab; }
.row.soldout .detail { color: #8893ab; }
.row.soldout .chip { background: #2a3248; color: #c4cce0; }
.row.off .chip { background: #2a3248; color: #c4cce0; }
.activity .row { grid-template-columns: 2fr 1fr; }
.activity .detail { justify-self: end; }
@media (max-width: 40rem) { .row { grid-template-columns: 1fr auto; } .row .detail { grid-column: 1 / -1; } }
`;

export const BOARD_JS = `(function () {
  'use strict';
  var root = document.getElementById('board');
  var workspaceId = root.getAttribute('data-workspace');
  var pollMs = Number(root.getAttribute('data-poll-ms')) || 3000;
  var token = readToken();
  var etag = null;
  var hasData = false;
  var lastOkAt = null;

  var GROUPS = [
    ['inventory_item', 'Stock'],
    ['equipment', 'Equipment'],
    ['menu_item', 'Menu'],
    ['job', 'Jobs'],
    ['technician', 'Technicians']
  ];

  // The access token travels in the address fragment (#token=...), which is never sent to a server or logged.
  function readToken() {
    var match = /(?:^|[#&])token=([^&]*)/.exec(location.hash || '');
    return match ? decodeURIComponent(match[1]) : null;
  }
  function byId(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }
  function replace(node, children) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
    children.forEach(function (child) { node.appendChild(child); });
  }
  function spaced(value) { return String(value).replace(/_/g, ' '); }
  function clock(date) { return date.toLocaleTimeString(); }

  function row(resource, classes, detail, chip) {
    var node = el('li', 'row ' + classes.join(' '));
    node.appendChild(el('span', 'name', resource.name));
    node.appendChild(el('span', 'detail', detail));
    node.appendChild(el('span', 'chip', chip));
    return node;
  }

  function resourceRow(resource, names) {
    var a = resource.attributes || {};
    var classes = resource.hasAlert ? ['alert'] : [];
    if (resource.type === 'inventory_item') {
      return row(resource, classes, a.quantity + ' ' + a.unit + ' (reorder at ' + a.reorderLevel + ')', resource.hasAlert ? 'low stock' : 'in stock');
    }
    if (resource.type === 'equipment') {
      if (a.status !== 'available') { classes.push('down'); }
      return row(resource, classes, '', spaced(a.status));
    }
    if (resource.type === 'menu_item') {
      if (a.status === 'sold_out') { classes.push('soldout'); }
      return row(resource, classes, a.price + ' ' + a.currency, spaced(a.status));
    }
    if (resource.type === 'job') {
      var who = a.assigneeId ? (names[a.assigneeId] || a.assigneeId) : 'unassigned';
      return row(resource, classes, a.description + ' · ' + who, spaced(a.status));
    }
    if (!a.active) { classes.push('off'); }
    return row(resource, classes, '', a.active ? 'on duty' : 'off duty');
  }

  function render(board) {
    byId('title').textContent = board.title;
    document.title = board.title + ' · VoiceOps';

    replace(byId('metrics'), board.metrics.map(function (metric) {
      var tile = el('div', 'metric');
      tile.appendChild(el('div', 'value', metric.value));
      tile.appendChild(el('div', 'label', metric.label));
      return tile;
    }));

    var alerts = byId('alerts');
    replace(alerts, board.alerts.map(function (alert) { return el('div', 'alert-banner', alert.message); }));
    alerts.hidden = board.alerts.length === 0;

    var names = {};
    board.resources.forEach(function (resource) { names[resource.id] = resource.name; });
    var groups = [];
    GROUPS.forEach(function (group) {
      var members = board.resources.filter(function (resource) { return resource.type === group[0]; });
      if (members.length === 0) { return; }
      var section = el('section', 'group');
      section.appendChild(el('h2', '', group[1]));
      var list = el('ul', 'rows');
      members.forEach(function (resource) { list.appendChild(resourceRow(resource, names)); });
      section.appendChild(list);
      groups.push(section);
    });
    replace(byId('resources'), groups);

    var activity = byId('activity');
    replace(byId('activity-list'), board.recentActivity.map(function (event) {
      var node = el('li', 'row');
      node.appendChild(el('span', 'name', event.summary));
      node.appendChild(el('span', 'detail', clock(new Date(event.createdAt))));
      return node;
    }));
    activity.hidden = board.recentActivity.length === 0;
  }

  function setStatus(kind, text) {
    var status = byId('status');
    status.className = 'status' + (kind === 'live' ? '' : ' ' + kind);
    status.textContent = text;
  }
  function markOk() {
    lastOkAt = new Date();
    setStatus('live', 'Live · updated ' + clock(lastOkAt));
  }
  function markFailed(reason) {
    if (hasData) {
      setStatus('stale', 'Offline: showing the last update from ' + clock(lastOkAt));
    } else {
      setStatus('error', reason + ' Retrying…');
    }
  }

  function poll() {
    var headers = { Accept: 'application/json' };
    if (token) { headers.Authorization = 'Bearer ' + token; }
    if (etag) { headers['If-None-Match'] = etag; }
    return fetch('/workspaces/' + encodeURIComponent(workspaceId) + '/board', { headers: headers, cache: 'no-store' })
      .then(function (response) {
        if (response.status === 304) {
          markOk();
          return null;
        }
        if (response.status === 401) { markFailed('This board needs an access token (add #token=... to the address).'); return null; }
        if (response.status === 404) { markFailed('There is no board for this workspace.'); return null; }
        if (!response.ok) { markFailed('The server answered ' + response.status + '.'); return null; }
        return response.json().then(function (board) {
          etag = response.headers.get('ETag');
          render(board);
          hasData = true;
          markOk();
        });
      })
      .catch(function () { markFailed('Cannot reach the server.'); })
      .then(function () { setTimeout(poll, pollMs); });
  }

  poll();
})();
`;
