// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  // Deep-link a view from the URL, so a screenshot can open the board, one protocol's detail, or a
  // filtered view: ?q=dex, ?category=Dexs, ?detail=<slug>, ?tab=live.
  var params = new URLSearchParams(window.location.search);
  var detailFromUrl = false;
  if (params.get('q')) state.q = params.get('q');
  if (params.get('category')) state.category = params.get('category');
  if (params.get('detail')) { state.selected = params.get('detail'); detailFromUrl = true; }
  if (params.get('tab')) state.tab = params.get('tab');

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainsMult = 1 + model.chains_bonus * Math.min(row.chains ? row.chains.length : 0, model.chains_cap);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * chainsMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p, age) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(age);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Join the protocol's Discord and follow its official X account, and watch only the links they publish for points, quests or airdrop news.", cost: 'nothing but your attention', time: '10 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    var key = state.sort;
    var dir = state.dir;
    rows = rows.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function pctClass(n) {
    if (n === null || n === undefined) return 'flat';
    return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var model = DATA.model;

    var hero = el('header', { 'class': 'hero' },
      el('h1', {}, 'Token ', el('span', { 'class': 'mark', text: 'Radar' }), ' — pre-token protocols, ranked by implied value'),
      el('p', { 'class': 'lede', text: 'What would a protocol\u2019s token be worth if it launched today, on the record as it stands? The board ranks the protocols that record no token, by an implied value computed from their own figures: TVL, seven-day growth, how long they have run with no token, and how many chains they run on. Every row carries a farm plan.' }),
      el('div', { 'class': 'stats' },
        el('div', { 'class': 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'protocols ranked' })),
        el('div', { 'class': 'stat' }, el('b', { text: String(DATA.watchlist_size) }), el('span', { text: 'on the watchlist floor' })),
        el('div', { 'class': 'stat' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'early finds below the floor' })),
        el('div', { 'class': 'stat' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'live tokens set aside' })),
        el('div', { 'class': 'stat' }, el('b', { text: DATA.as_of }), el('span', { text: 'snapshot date (UTC)' }))
      ),
      el('p', { 'class': 'model-note' },
        el('b', { text: 'Model ' + DATA.model_version + ': ' }),
        'implied = TVL \u00d7 ', el('code', { text: String(model.base_multiple) }),
        ' \u00d7 growth \u00d7 maturity \u00d7 chains. Growth is the 7-day change clamped to [',
        el('code', { text: String(model.growth_floor) }), ', ', el('code', { text: String(model.growth_cap) }),
        ']%, weighted ', el('code', { text: String(model.growth_weight) }),
        '. Maturity runs ', el('code', { text: String(model.maturity_floor) }), '\u2013',
        el('code', { text: String(model.maturity_floor + model.maturity_range) }),
        ' over ', el('code', { text: String(model.maturity_days) }), ' days. Chains add ',
        el('code', { text: String(model.chains_bonus) }), ' each, up to ', el('code', { text: String(model.chains_cap) }),
        '. No name is special-cased.'
      )
    );
    app.appendChild(hero);

    var tabs = el('div', { 'class': 'tabs', role: 'tablist' },
      el('button', { 'class': 'tab', role: 'tab', 'aria-selected': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board (' + DATA.board_size + ')', onclick: function () { state.tab = 'pre-token'; state.selected = null; render(); } }),
      el('button', { 'class': 'tab', role: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; state.selected = null; render(); } })
    );
    app.appendChild(tabs);

    if (state.tab === 'pre-token') {
      var sel = el('select', { 'aria-label': 'Filter by category', onchange: function (e) { state.category = e.target.value; render(); } },
        el('option', { value: 'all', text: 'All categories' })
      );
      categories().forEach(function (c) {
        var o = el('option', { value: c, text: c });
        if (state.category === c) o.selected = true;
        sel.appendChild(o);
      });
      var search = el('input', { type: 'search', placeholder: 'Search name, slug, chain\u2026', 'aria-label': 'Search protocols', value: state.q, oninput: function (e) { state.q = e.target.value; renderTable(); } });
      var controls = el('div', { 'class': 'controls' }, search, sel, el('span', { 'class': 'count', id: 'count' }));
      app.appendChild(controls);
      var wrap = el('div', { 'class': 'table-wrap', id: 'table-wrap' });
      app.appendChild(wrap);
      renderTable();
    } else {
      app.appendChild(el('p', { 'class': 'live-note', text: 'These protocols already have a token that trades, so the board shows the market\u2019s own value, not a model\u2019s. They are set aside from the ranking, for comparison.' }));
      var liveWrap = el('div', { 'class': 'table-wrap' });
      var liveTable = el('table', { 'class': 'board' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { 'class': 'num', text: 'TVL' }),
          el('th', { 'class': 'num', text: 'Market cap' }), el('th', { 'class': 'num', text: '7d' })
        )),
        el('tbody', {}, DATA.live.map(function (p) {
          return el('tr', {},
            el('td', { 'class': 'name' }, p.name, el('span', { 'class': 'slug', text: p.slug })),
            el('td', {}, el('span', { 'class': 'pill', text: p.category || 'n/a' })),
            el('td', { 'class': 'num', text: fmtUsd(p.tvl_usd) }),
            el('td', { 'class': 'num', text: fmtUsd(p.mcap_usd) }),
            el('td', { 'class': 'num ' + pctClass(p.change_7d), text: fmtPct(p.change_7d) })
          );
        }))
      );
      liveWrap.appendChild(liveTable);
      app.appendChild(liveWrap);
    }

    if (state.selected) renderDetail();
    app.appendChild(el('footer', { 'class': 'foot', text: 'Source: ' + DATA.source + '. A protocol records no token when its DefiLlama record carries none; that is not proof it has none. Implied values are this radar\u2019s own claim, never a promise of a launch.' }));
  }

  function renderTable() {
    var wrap = document.getElementById('table-wrap');
    if (!wrap) return;
    var rows = filteredRows();
    var count = document.getElementById('count');
    if (count) count.textContent = rows.length + ' of ' + DATA.board_size + ' rows';
    wrap.innerHTML = '';
    if (rows.length === 0) {
      wrap.appendChild(el('div', { 'class': 'empty', text: 'No protocol matches that filter.' }));
      return;
    }
    function th(label, key, cls) {
      var h = el('th', { 'class': cls || '', text: label });
      if (key) {
        h.setAttribute('aria-sort', state.sort === key ? (state.dir === -1 ? 'descending' : 'ascending') : 'none');
        h.addEventListener('click', function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = -1; }
          renderTable();
        });
      }
      return h;
    }
    var table = el('table', { 'class': 'board' },
      el('thead', {}, el('tr', {},
        th('#', 'rank'), th('Protocol', 'name'), th('Category'), th('Chains'), th('TVL', 'tvl', 'num'),
        th('7d', 'growth', 'num'), th('Age', 'age', 'num'), th('Implied value', 'implied', 'num')
      )),
      el('tbody', {}, rows.map(function (r) {
        var tr = el('tr', { 'aria-selected': state.selected === r.slug ? 'true' : 'false', onclick: function () { state.selected = r.slug; render(); window.scrollTo(0, document.body.scrollHeight); } },
          el('td', { 'class': 'rank' }, el('b', { text: String(r.rank) })),
          el('td', { 'class': 'name' }, r.name, el('span', { 'class': 'slug', text: r.slug })),
          el('td', {}, el('span', { 'class': 'pill pre', text: r.category || 'n/a' })),
          el('td', { text: (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + ((r.chains || []).length - 2) : '') }),
          el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { 'class': 'num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) }),
          el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
          el('td', { 'class': 'num', text: fmtUsd(r.implied_value_usd) })
        );
        return tr;
      }))
    );
    wrap.appendChild(table);
  }

  function renderDetail() {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { row = DATA.rows[i]; break; }
    if (!row) return;
    var model = DATA.model;
    var recomputed = impliedOf(row, model);
    var steps = farmSteps(row, row.age_days).map(stepText);
    var detail = el('section', { 'class': 'detail', 'aria-label': 'Protocol detail' },
      el('button', { 'class': 'close', text: 'Close', onclick: function () { state.selected = null; render(); } }),
      el('h2', {}, row.name, el('span', { 'class': 'slug', text: row.slug })),
      el('p', { 'class': 'sub', text: 'Rank #' + row.rank + ' \u00b7 ' + (row.category || 'uncategorised') + ' \u00b7 ' + (row.chains || []).join(', ') + ' \u00b7 tracked since ' + (row.listed_at || 'unknown') + ' \u00b7 records no token.' }),
      el('div', { 'class': 'detail-grid' },
        el('div', { 'class': 'cell' }, el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'implied value (page recomputes ' + fmtUsd(recomputed) + ')' })),
        el('div', { 'class': 'cell' }, el('b', { text: fmtUsd(row.tvl_usd) }), el('span', { text: 'TVL' })),
        el('div', { 'class': 'cell' }, el('b', { text: fmtPct(row.change_7d) }), el('span', { text: 'TVL change, 7 days' })),
        el('div', { 'class': 'cell' }, el('b', { text: fmtAge(row.age_days) }), el('span', { text: 'age with no token' })),
        el('div', { 'class': 'cell' }, el('b', { text: String((row.chains || []).length) }), el('span', { text: 'chains' }))
      ),
      el('h3', { text: 'How the value is built' }),
      el('div', { 'class': 'model-break' },
        'implied = TVL \u00d7 ', el('b', { text: String(model.base_multiple) }),
        ' \u00d7 growth ', el('b', { text: row.growth_multiplier.toFixed(4) }),
        ' \u00d7 maturity ', el('b', { text: row.maturity_multiplier.toFixed(4) }),
        ' \u00d7 chains ', el('b', { text: row.chains_multiplier.toFixed(4) }),
        ' = ', el('b', { text: fmtUsd(row.implied_value_usd) })
      ),
      el('h3', { text: 'Farm plan \u2014 seven steps' }),
      el('ol', { 'class': 'farm' }, steps.map(function (s) {
        return el('li', {}, s, el('span', { 'class': 'cost', text: '' }));
      }))
    );
    app.appendChild(detail);
  }

  render();
  // A detail opened from the URL is the screenshot's subject: bring it into view on load.
  if (detailFromUrl && state.selected) {
    var detail = document.querySelector('.detail');
    if (detail) detail.scrollIntoView({ block: 'start' });
  }
})();
