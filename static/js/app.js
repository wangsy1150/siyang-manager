/* =========================================================
   思洋 · 个人管理台 —— 交互脚本（原生 JS，零依赖）
   ---------------------------------------------------------
   和后端的分工（改了之后要记住这条）：

     后端 app.py  = 唯一数据源。所有数据都从它来，所有改动都回到它那儿。
     这个文件     = 只做两件事：① 把后端数据画成页面 ② 把用户的操作发给后端

   所以这里已经没有任何"写死的业务数据"了 —— 
   数据从 window.__BOOT__ 来（由 Jinja 在 HTML 里注入，见 templates/index.html），
   增删改查走 /api/... 接口，接口返回最新的全量数据，整体重绘。

   1) 工具与启动数据
   2) 可复用 HTML 片段（输入框 / 行内按钮 / 空状态）
   3) 八个列表的渲染函数
   4) 与后端通信（fetch 封装 + 增删改查）
   5) 页面切换 + 只持久化"当前页"
   6) 事件委托与初始化
   ========================================================= */

(function () {
  'use strict';

  /* =========================================================
     1. 工具与启动数据
     ========================================================= */

  // 后端在 HTML 里注入的那份数据。兜底成空对象，避免 JS 单独调试时报错。
  const BOOT = window.__BOOT__ || { lists: {} };

  // 这几个变量会被 applyBoot() 覆盖 —— 它们只是"当前状态"的本地副本，
  // 真正的源永远在后端。
  let OWNER = BOOT.owner || '思洋';
  let QUOTES = BOOT.quotes || [];
  let STATS = BOOT.stats || { todo: 0, done: 0, checkin: 0, word: 0 };
  // 八个列表。名字必须和 app.py 里 SCHEMA 的键完全一致 —— 它同时也是接口路径。
  let data = BOOT.lists || {
    plans: [], todos: [], words: [], workouts: [],
    meals: [], checkins: [], media: [], memos: []
  };

  const PAGE_KEY = 'siyang:activePage';       // 只存当前选中页
  const PAGES = ['home', 'plan', 'todo', 'english', 'fitness', 'meal', 'checkin', 'media', 'memo'];

  const $  = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // 所有用户输入都要走这里：模板里拼 HTML 之前先转义，避免输入 <script> 之类把结构撑破
  const esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // 表单字段被要求填写但为空时，用表单里那行中文 label 提示，而不是抛英文字段名
  const labelOf = function (form, name) {
    const el = form.querySelector('[name="' + name + '"]');
    const field = el && el.closest('.field');
    const span = field && field.querySelector('span');
    return span ? span.textContent.trim() : name;
  };

  /* ---------------------------------------------------------
     客户端仍需知道的一点规则
     ---------------------------------------------------------
     注意：app.py 里有一份「权威版」的 SCHEMA 和 FIELD_LABEL。
     这里再写一份，只是为了在本地先把空字段拦下来，
     让用户不用等一次网络往返才看到提示。

     ⚠️ 两边都要改的地方：新增/删除字段时，app.py 的 SCHEMA 和这里的
        SCHEMA、FIELD_LABEL 都得同步。真正的守门人永远是后端 ——
        就算有人绕过前端直接调接口，后端照样会拦。
     --------------------------------------------------------- */

  const SCHEMA = {
    plans:    { required: ['time', 'task'] },
    todos:    { required: ['text'] },
    words:    { required: ['word', 'meaning'] },
    workouts: { required: ['name'] },
    meals:    { required: ['meal', 'menu'] },
    checkins: { required: ['text'] },
    media:    { required: ['title'] },
    memos:    { required: ['text'] }
  };

  const FIELD_LABEL = {
    time: '时段', task: '要做的事', tag: '分类标签',
    text: '内容', word: '单词', phonetic: '音标', meaning: '释义',
    name: '项目名称', duration: '时长', sets: '组数', note: '备注',
    meal: '餐次', menu: '菜单', kcal: '热量',
    title: '内容标题', platform: '平台', status: '状态', views: '浏览量'
  };

  /* =========================================================
     2. 可复用 HTML 片段
     ========================================================= */

  // 编辑态输入框。attr 可传 { placeholder, type }
  function inputHtml(name, value, attr) {
    const a = attr || {};
    const type = a.type || 'text';
    const ph = a.placeholder ? ' placeholder="' + esc(a.placeholder) + '"' : '';
    return '<input class="input" type="' + type + '" data-field="' + name + '" value="' + esc(value) + '"' +
           ' aria-label="' + esc(FIELD_LABEL[name] || name) + '"' + ph + '>';
  }

  function selectHtml(name, value, options) {
    const opts = options.map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');
    return '<select class="input" data-field="' + name + '" aria-label="' + esc(FIELD_LABEL[name] || name) + '">' + opts + '</select>';
  }

  /* 注意：行容器用 data-row，行内按钮用 data-id。
     两者若同名，btn.closest('[data-id]') 会返回按钮自己（按钮上也带 data-id），
     导致读不到行内的输入框 —— 这是踩过的坑。 */

  // 行右侧的「编辑 / 删除」；删除需要点两下，第一下变成红色确认态
  function actionsHtml(list, id, labels) {
    const l = labels || { edit: '编辑', del: '删除' };
    const armed = pending && pending.list === list && pending.id === id;
    return '<div class="row__actions">' +
             '<button class="btn btn--sm btn--ghost" type="button" data-action="edit" data-list="' + list + '" data-id="' + id + '">' + l.edit + '</button>' +
             '<button class="btn btn--sm btn--ghost btn--danger" type="button" data-action="del" data-list="' + list + '" data-id="' + id + '"' +
               (armed ? ' data-armed="1"' : '') + '>' + (armed ? '确认删除' : l.del) + '</button>' +
           '</div>';
  }

  function saveCancelHtml(list, id) {
    return '<div class="row__actions">' +
             '<button class="btn btn--sm btn--primary" type="button" data-action="save" data-list="' + list + '" data-id="' + id + '">保存</button>' +
             '<button class="btn btn--sm btn--ghost" type="button" data-action="cancel">取消</button>' +
           '</div>';
  }

  // 空状态。tag 可指定：ul 里用 li，卡片网格（div）里用 div，保证标签嵌套合法
  function emptyHtml(text, icon, tag) {
    const t = tag || 'li';
    return '<' + t + ' class="empty"><span aria-hidden="true">' + (icon || '🌱') + '</span><span>' + esc(text) + '</span></' + t + '>';
  }

  /* =========================================================
     3. 渲染
     ========================================================= */

  let editing = null;   // { list, id } 正在编辑的条目
  let pending = null;   // { list, id } 等待二次确认删除的条目
  let pendingTimer = null;

  const isEditing = function (list, id) {
    return !!editing && editing.list === list && editing.id === id;
  };

  const findItem = function (list, id) {
    return data[list].filter(function (x) { return x.id === id; })[0];
  };

  /* ---- 3.1 首页 ---- */

  // 问候语和日期由后端算好（见 app.py 的 build_greeting / build_date_text）。
  // 以前这里要判断小时、拼星期，现在直接取 —— 时区、语言这些都归后端管了。
  function renderGreeting() {
    const g = $('#greeting');
    const t = $('#today');
    if (g) g.textContent = BOOT.greeting || ('你好，' + OWNER);
    if (t) t.textContent = BOOT.date_text || '';
  }

  // 4 个数字同理：口径在后端 build_stats() 里，前端不重复算一遍。
  function renderStats() {
    $('#stat-todo').textContent = STATS.todo;
    $('#stat-done').textContent = STATS.done;
    $('#stat-checkin').textContent = STATS.checkin;
    $('#stat-word').textContent = STATS.word;
  }

  function renderQuotes() {
    $('#quotes').innerHTML = QUOTES.map(function (q) {
      return '<figure class="quote">' +
               '<blockquote class="quote__text">' + esc(q.text) + '</blockquote>' +
               '<figcaption class="quote__from">' + esc(q.from) + '</figcaption>' +
             '</figure>';
    }).join('');
  }

  /* ---- 3.2 每日计划 ---- */

  function renderPlans() {
    const box = $('#list-plans');
    if (!data.plans.length) { box.innerHTML = emptyHtml('还没有安排，先给今天排个时间表吧', '📅'); return; }

    box.innerHTML = data.plans.map(function (p) {
      if (isEditing('plans', p.id)) {
        return '<li class="row row--edit" data-row="' + p.id + '">' +
                 '<div class="row__fields">' +
                   inputHtml('time', p.time, { placeholder: '09:00 – 10:30' }) +
                   inputHtml('task', p.task, { placeholder: '要做的事' }) +
                   inputHtml('tag',  p.tag,  { placeholder: '分类标签' }) +
                 '</div>' + saveCancelHtml('plans', p.id) +
               '</li>';
      }
      return '<li class="row" data-row="' + p.id + '">' +
               '<span class="row__time">' + esc(p.time) + '</span>' +
               '<span class="row__main">' + esc(p.task) + '</span>' +
               '<span class="tag">' + esc(p.tag || '未分类') + '</span>' +
               actionsHtml('plans', p.id) +
             '</li>';
    }).join('');
  }

  /* ---- 3.3 待办清单 ---- */

  function renderTodos() {
    const box = $('#list-todos');
    if (!data.todos.length) { box.innerHTML = emptyHtml('待办是空的，先写一件今天必须做的事', '📋'); return; }

    box.innerHTML = data.todos.map(function (t) {
      if (isEditing('todos', t.id)) {
        return '<li class="row row--edit" data-row="' + t.id + '">' +
                 '<label class="check"><input type="checkbox" data-toggle="todos" data-id="' + t.id + '"' +
                   (t.done ? ' checked' : '') + ' aria-label="完成状态"></label>' +
                 '<div class="row__fields">' + inputHtml('text', t.text, { placeholder: '待办内容' }) + '</div>' +
                 saveCancelHtml('todos', t.id) +
               '</li>';
      }
      return '<li class="row todo' + (t.done ? ' is-done' : '') + '" data-row="' + t.id + '">' +
               '<label class="check"><input type="checkbox" data-toggle="todos" data-id="' + t.id + '"' +
                 (t.done ? ' checked' : '') + ' aria-label="标记完成：' + esc(t.text) + '"></label>' +
               '<span class="row__main todo__text">' + esc(t.text) + '</span>' +
               actionsHtml('todos', t.id) +
             '</li>';
    }).join('');
  }

  /* ---- 3.4 英语学习 ---- */

  function renderWords() {
    const box = $('#list-words');
    if (!data.words.length) { box.innerHTML = emptyHtml('还没有单词，先加几个今天的', '📚', 'div'); return; }

    box.innerHTML = data.words.map(function (w) {
      if (isEditing('words', w.id)) {
        return '<article class="tile tile--edit" data-row="' + w.id + '">' +
                 '<div class="row__fields">' +
                   inputHtml('word', w.word, { placeholder: '单词' }) +
                   inputHtml('phonetic', w.phonetic, { placeholder: '/音标/' }) +
                   inputHtml('meaning', w.meaning, { placeholder: '释义' }) +
                 '</div>' + saveCancelHtml('words', w.id) +
               '</article>';
      }
      return '<article class="tile" data-row="' + w.id + '">' +
               '<div class="tile__body">' +
                 '<h3 class="tile__title">' + esc(w.word) + '</h3>' +
                 (w.phonetic ? '<p class="tile__phonetic">' + esc(w.phonetic) + '</p>' : '') +
                 '<p class="tile__desc">' + esc(w.meaning) + '</p>' +
               '</div>' + actionsHtml('words', w.id) +
             '</article>';
    }).join('');
  }

  /* ---- 3.5 锻炼身体 ---- */

  function renderWorkouts() {
    const box = $('#list-workouts');
    if (!data.workouts.length) { box.innerHTML = emptyHtml('今天还没安排训练，先写一个项目', '💪'); return; }

    box.innerHTML = data.workouts.map(function (w, i) {
      if (isEditing('workouts', w.id)) {
        return '<li class="row row--edit" data-row="' + w.id + '">' +
                 '<span class="idx">' + (i + 1) + '</span>' +
                 '<div class="row__fields">' +
                   inputHtml('name', w.name, { placeholder: '项目名称' }) +
                   inputHtml('duration', w.duration, { placeholder: '时长' }) +
                   inputHtml('sets', w.sets, { placeholder: '组数' }) +
                   inputHtml('note', w.note, { placeholder: '备注 / 要领' }) +
                 '</div>' + saveCancelHtml('workouts', w.id) +
               '</li>';
      }
      return '<li class="row" data-row="' + w.id + '">' +
               '<span class="idx">' + (i + 1) + '</span>' +
               '<span class="row__main"><strong>' + esc(w.name) + '</strong>' +
                 (w.note ? '<span class="muted"> · ' + esc(w.note) + '</span>' : '') +
               '</span>' +
               '<span class="metrics">' +
                 (w.duration ? '<span class="metric">⏱ ' + esc(w.duration) + '</span>' : '') +
                 (w.sets ? '<span class="metric">🔁 ' + esc(w.sets) + '</span>' : '') +
               '</span>' +
               actionsHtml('workouts', w.id) +
             '</li>';
    }).join('');
  }

  /* ---- 3.6 好好吃饭 ---- */

  function renderMeals() {
    const box = $('#list-meals');
    if (!data.meals.length) { box.innerHTML = emptyHtml('还没写今天吃什么，先把三餐定下来', '🍱', 'div'); return; }

    box.innerHTML = data.meals.map(function (m) {
      if (isEditing('meals', m.id)) {
        return '<article class="tile tile--edit" data-row="' + m.id + '">' +
                 '<div class="row__fields">' +
                   inputHtml('meal', m.meal, { placeholder: '餐次' }) +
                   inputHtml('menu', m.menu, { placeholder: '菜单' }) +
                   inputHtml('kcal', m.kcal, { placeholder: '热量 kcal' }) +
                   inputHtml('tag',  m.tag,  { placeholder: '标签' }) +
                 '</div>' + saveCancelHtml('meals', m.id) +
               '</article>';
      }
      return '<article class="tile" data-row="' + m.id + '">' +
               '<div class="tile__body">' +
                 '<div class="tile__top">' +
                   '<h3 class="tile__title">' + esc(m.meal) + '</h3>' +
                   (m.kcal ? '<span class="kcal">' + esc(m.kcal) + ' kcal</span>' : '') +
                 '</div>' +
                 '<p class="tile__desc">' + esc(m.menu) + '</p>' +
                 (m.tag ? '<span class="tag">' + esc(m.tag) + '</span>' : '') +
               '</div>' + actionsHtml('meals', m.id) +
             '</article>';
    }).join('');
  }

  /* ---- 3.7 每日打卡 ---- */

  // 注意：c.at 已经是后端算好的「今天 21:40」这种说法（见 app.py 的 _checkin_view），
  // 前端不再需要拼时间字符串。
  function renderCheckins() {
    const box = $('#list-checkins');
    if (!data.checkins.length) { box.innerHTML = emptyHtml('今天还没打卡，写一句话给自己', '✍️'); return; }

    box.innerHTML = data.checkins.map(function (c) {
      if (isEditing('checkins', c.id)) {
        return '<li class="row row--edit" data-row="' + c.id + '">' +
                 '<div class="row__fields">' + inputHtml('text', c.text, { placeholder: '今天的心情' }) + '</div>' +
                 saveCancelHtml('checkins', c.id) +
               '</li>';
      }
      return '<li class="row" data-row="' + c.id + '">' +
               '<span class="tag">@' + esc(OWNER) + '</span>' +
               '<span class="row__main">' + esc(c.text) + '</span>' +
               (c.at ? '<span class="row__meta">' + esc(c.at) + '</span>' : '') +
               actionsHtml('checkins', c.id, { edit: '修改', del: '删除' }) +
             '</li>';
    }).join('');
  }

  /* ---- 3.8 自媒体 ---- */

  function viewsText(v) {
    const n = Number(v) || 0;
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
    return n.toLocaleString('zh-CN');
  }

  function statusClass(s) {
    if (s === '已发布') return 'status--done';
    if (s === '撰写中') return 'status--doing';
    return 'status--idea';
  }

  function renderMedia() {
    const box = $('#list-media');
    if (!data.media.length) { box.innerHTML = emptyHtml('还没有选题，先记下一个想做的内容', '📱'); return; }

    box.innerHTML = data.media.map(function (m) {
      if (isEditing('media', m.id)) {
        return '<li class="row row--edit" data-row="' + m.id + '">' +
                 '<div class="row__fields">' +
                   inputHtml('title', m.title, { placeholder: '内容标题' }) +
                   selectHtml('platform', m.platform, ['CSDN', '知乎', 'B站', '小红书', '抖音', '公众号']) +
                   selectHtml('status', m.status, ['构思中', '撰写中', '已发布']) +
                   inputHtml('views', m.views, { type: 'number', placeholder: '浏览量' }) +
                 '</div>' + saveCancelHtml('media', m.id) +
               '</li>';
      }
      return '<li class="row" data-row="' + m.id + '">' +
               '<span class="row__main">' + esc(m.title) + '</span>' +
               '<span class="tag tag--plain">' + esc(m.platform) + '</span>' +
               '<span class="views">👁 ' + viewsText(m.views) + '</span>' +
               '<span class="status ' + statusClass(m.status) + '">' + esc(m.status) + '</span>' +
               actionsHtml('media', m.id) +
             '</li>';
    }).join('');
  }

  /* ---- 3.9 备忘录 ---- */

  // 存储用 "2026-09-21T16:00"，展示用 "9月21日 16:00"，避免把机器格式塞给用户看
  function memoTimeText(v) {
    if (!v) return '未设时间';
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderMemos() {
    const box = $('#list-memos');
    if (!data.memos.length) { box.innerHTML = emptyHtml('小本本还是空的，记点什么吧', '📝'); return; }

    box.innerHTML = data.memos.map(function (n) {
      if (isEditing('memos', n.id)) {
        return '<li class="row row--edit" data-row="' + n.id + '">' +
                 '<div class="row__fields">' +
                   inputHtml('time', n.time, { type: 'datetime-local' }) +
                   inputHtml('text', n.text, { placeholder: '备忘内容' }) +
                 '</div>' + saveCancelHtml('memos', n.id) +
               '</li>';
      }
      return '<li class="row" data-row="' + n.id + '">' +
               '<span class="row__time">' + esc(memoTimeText(n.time)) + '</span>' +
               '<span class="row__main">' + esc(n.text) + '</span>' +
               actionsHtml('memos', n.id) +
             '</li>';
    }).join('');
  }

  /* ---- 渲染调度 ---- */

  const RENDERERS = {
    plans: renderPlans,
    todos: renderTodos,
    words: renderWords,
    workouts: renderWorkouts,
    meals: renderMeals,
    checkins: renderCheckins,
    media: renderMedia,
    memos: renderMemos
  };

  function renderList(list) {
    if (RENDERERS[list]) RENDERERS[list]();
    renderStats();
  }

  function renderAll() {
    renderGreeting();
    renderStats();
    renderQuotes();
    Object.keys(RENDERERS).forEach(function (k) { RENDERERS[k](); });
  }

  /* =========================================================
     4. 与后端通信
     ========================================================= */

  // fetch 封装：统一处理 JSON 解析和错误，让下面三个函数都能写成 try/catch。
  // 约定的返回格式见 app.py：
  //   成功 {"ok": true,  "boot": {...}}
  //   失败 {"ok": false, "error": "人话"}
  function api(url, options) {
    const opt = Object.assign({
      headers: { 'Content-Type': 'application/json' }
    }, options || {});

    return fetch(url, opt).then(function (res) {
      return res.json().catch(function () {
        // 服务端返回了非 JSON（例如 500 的 HTML 错误页），这里兜一下
        throw new Error('服务端返回了无法解析的内容（HTTP ' + res.status + '）');
      }).then(function (json) {
        // 401 = 没登录 / 登录态过期。后端这里必须是 JSON，
        // 因为要由前端决定「跳登录页」这件事，不能靠 HTTP 重定向。
        if (res.status === 401) {
          window.location.href = '/login';
          throw new Error(json.error || '请先登录');
        }
        if (!res.ok || !json.ok) throw new Error(json.error || ('请求失败（HTTP ' + res.status + '）'));
        return json;
      });
    }).catch(function (err) {
      // 网络层失败（服务没起来 / 端口不对）也变成一句人话
      if (err instanceof TypeError) throw new Error('连不上后端，确认 python app.py 还在跑');
      throw err;
    });
  }

  /* 把后端返回的最新数据接到本地并重绘。
     每次写操作后都调用它 —— 「服务端是唯一真相」这件事就靠这个函数落地：
     前端从不自己推测「改完之后应该长什么样」，而是拿服务端算好的结果画。 */
  function applyBoot(boot) {
    if (!boot) return;
    OWNER = boot.owner || OWNER;
    QUOTES = boot.quotes || QUOTES;
    STATS = boot.stats || STATS;
    data = boot.lists || data;
    BOOT.greeting = boot.greeting || BOOT.greeting;
    BOOT.date_text = boot.date_text || BOOT.date_text;

    renderAll();

    // 名字同步到标题和品牌（后端改了 OWNER，这里也跟着变）
    document.title = OWNER + ' · 个人管理台';
    const brandMark = document.querySelector('.brand__mark');
    const brandName = document.querySelector('.brand__text strong');
    if (brandMark) brandMark.textContent = OWNER.charAt(0);
    if (brandName) brandName.textContent = OWNER + '管理台';
  }

  /* =========================================================
     5. 增 / 删 / 改 / 勾选（全部走接口）
     ========================================================= */

  // 各页"添加"表单：提交到哪个接口 + 哪些字段必填
  const FORM_RULES = {
    plan:    { list: 'plans',    required: ['time', 'task'] },
    todo:    { list: 'todos',    required: ['text'] },
    word:    { list: 'words',    required: ['word', 'meaning'] },
    workout: { list: 'workouts', required: ['name'] },
    meal:    { list: 'meals',    required: ['meal', 'menu'] },
    checkin: { list: 'checkins', required: ['text'] },
    media:   { list: 'media',    required: ['title'] },
    memo:    { list: 'memos',    required: ['text'] }
  };

  // datetime-local 需要 "YYYY-MM-DDTHH:mm"（本地时区），不能用 toISOString（那是 UTC）
  function nowLocal() {
    const d = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.classList.remove('is-on'); }, 2000);
  }

  // 添加 ——> POST /api/<list>
  function handleSubmit(form) {
    const rule = FORM_RULES[form.dataset.form];
    if (!rule) return;

    const v = {};
    $$('[name]', form).forEach(function (el) { v[el.name] = el.value.trim(); });

    // 先在本地拦一道空值（即时反馈），后端还会再校验一次
    const missing = rule.required.filter(function (f) { return !v[f]; });
    if (missing.length) {
      showToast('请先填写：' + missing.map(function (f) { return labelOf(form, f); }).join('、'));
      const first = form.querySelector('[name="' + missing[0] + '"]');
      if (first) first.focus();
      return;
    }

    api('/api/' + rule.list, { method: 'POST', body: JSON.stringify(v) })
      .then(function (json) {
        applyBoot(json.boot);
        form.reset();

        // 备忘录的时间：重置后自动填回"现在"，省掉一次手输
        if (form.dataset.form === 'memo') {
          const t = form.querySelector('[name="time"]');
          if (t) t.value = nowLocal();
        }
        showToast('已添加 ✓');
      })
      .catch(function (err) { showToast(err.message); });
  }

  // 保存编辑 ——> PUT /api/<list>/<id>
  function handleSave(btn) {
    const list = btn.dataset.list;
    const id = btn.dataset.id;
    const row = btn.closest('[data-row]');
    if (!row) return;

    const v = {};
    $$('[data-field]', row).forEach(function (el) { v[el.dataset.field] = el.value.trim(); });

    const missing = (SCHEMA[list].required || []).filter(function (f) { return !v[f]; });
    if (missing.length) {
      showToast('「' + (FIELD_LABEL[missing[0]] || missing[0]) + '」不能为空');
      const first = row.querySelector('[data-field="' + missing[0] + '"]');
      if (first) first.focus();
      return;
    }

    api('/api/' + list + '/' + id, { method: 'PUT', body: JSON.stringify(v) })
      .then(function (json) {
        editing = null;
        applyBoot(json.boot);
        showToast('已保存 ✓');
      })
      .catch(function (err) { showToast(err.message); });
  }

  // 删除（两段式：先变成"确认删除"，3 秒内再点一次才真删）——> DELETE /api/<list>/<id>
  function handleDelete(btn) {
    const list = btn.dataset.list;
    const id = btn.dataset.id;

    if (pending && pending.list === list && pending.id === id) {
      api('/api/' + list + '/' + id, { method: 'DELETE' })
        .then(function (json) {
          pending = null;
          editing = null;
          clearTimeout(pendingTimer);
          applyBoot(json.boot);
          showToast('已删除');
        })
        .catch(function (err) {
          pending = null;
          clearTimeout(pendingTimer);
          renderList(list);
          showToast(err.message);
        });
      return;
    }

    pending = { list: list, id: id };
    editing = null;
    renderAll();
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      pending = null;
      renderList(list);
    }, 3000);
  }

  // 勾选待办 ——> PUT /api/todos/<id>，只传 done 这一个字段（局部更新）
  //
  // 小细节：这里先把本地那份数据改了、立刻重绘，用户体验上是"瞬间变色"；
  // 请求回来后 applyBoot() 会用服务端的权威结果覆盖一遍。
  // 万一请求失败（比如服务被关了），applyBoot 没执行，但下一次成功的请求会把它纠正回来。
  function handleToggle(cb) {
    const list = cb.dataset.toggle;
    const id = cb.dataset.id;
    const item = findItem(list, id);
    if (!item) return;

    item.done = cb.checked;
    renderAll();
    showToast(cb.checked ? '完成一件 ✓' : '已取消勾选');

    api('/api/' + list + '/' + id, { method: 'PUT', body: JSON.stringify({ done: cb.checked }) })
      .then(function (json) { applyBoot(json.boot); })
      .catch(function (err) {
        item.done = !cb.checked;      // 失败就回滚，别让界面骗人
        renderAll();
        showToast(err.message);
      });
  }

  /* =========================================================
     6. 页面切换（点击切页，浏览器不刷新；只把"当前页"写进 localStorage）
     ========================================================= */

  function go(page, opts) {
    if (PAGES.indexOf(page) === -1) page = 'home';

    $$('.page').forEach(function (sec) {
      const on = sec.dataset.page === page;
      sec.hidden = !on;
      if (on) {
        // 重置动画：先摘掉类、强制回流、再加回去，否则第二次进来不会重播
        sec.classList.remove('is-enter');
        void sec.offsetWidth;
        sec.classList.add('is-enter');
      }
    });

    let activeBtn = null;
    $$('.nav__item').forEach(function (btn) {
      const on = btn.dataset.page === page;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
      if (on) activeBtn = btn;
    });

    try { localStorage.setItem(PAGE_KEY, page); } catch (e) { /* 隐私模式下存不了，忽略即可 */ }

    window.scrollTo(0, 0);

    // 手机端：把当前 tab 滚进可视区域，让"我在哪"看得见
    if (activeBtn && window.matchMedia('(max-width: 880px)').matches) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  /* =========================================================
     7. 事件绑定与初始化
     ========================================================= */

  function bindEvents() {
    // 7.1 导航
    $('#nav').addEventListener('click', function (e) {
      const btn = e.target.closest('.nav__item');
      if (btn) go(btn.dataset.page);
    });

    // 7.2 行内按钮：编辑 / 保存 / 取消 / 删除（统一委托，新增的行无需重新绑定）
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'edit') {
        editing = { list: btn.dataset.list, id: btn.dataset.id };
        pending = null;
        renderList(btn.dataset.list);
        const row = document.querySelector('[data-row="' + btn.dataset.id + '"]');
        const first = row && row.querySelector('input, select');
        if (first) first.focus();
        return;
      }

      if (action === 'save')   { handleSave(btn); return; }

      if (action === 'cancel') {
        editing = null;
        pending = null;
        renderAll();
        return;
      }

      if (action === 'del')    { handleDelete(btn); return; }
    });

    // 7.3 待办勾选：勾上就变灰加删除线，并同步首页"已完成"
    document.addEventListener('change', function (e) {
      const cb = e.target.closest('[data-toggle]');
      if (cb) handleToggle(cb);
    });

    // 7.4 各页"添加"表单
    document.addEventListener('submit', function (e) {
      const form = e.target.closest('form[data-form]');
      if (!form) return;
      e.preventDefault();   // 关键：阻止默认提交，页面不刷新
      handleSubmit(form);
    });
  }

  function init() {
    // 首屏数据已经在 HTML 里了（Jinja 注入的 window.__BOOT__），
    // 所以这里不需要再发一次请求 —— 页面打开就是完整内容，白屏时间最短。
    applyBoot(BOOT);

    bindEvents();

    // 备忘录时间默认填"现在"
    const memoTime = document.querySelector('form[data-form="memo"] [name="time"]');
    if (memoTime) memoTime.value = nowLocal();

    // 恢复上次停留的页面；读不到就回首页
    let saved = null;
    try { saved = localStorage.getItem(PAGE_KEY); } catch (e) { saved = null; }
    go(PAGES.indexOf(saved) !== -1 ? saved : 'home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
