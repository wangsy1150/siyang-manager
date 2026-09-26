/* =========================================================
   思洋 · 个人管理台 —— 交互脚本（原生 JS，零依赖）
   ---------------------------------------------------------
   1) 工具与常量
   2) 占位数据（列表数据不落 localStorage，刷新回到示例）
   3) 可复用 HTML 片段（输入框 / 行内按钮 / 空状态）
   4) 八个列表的渲染函数
   5) 增删改查
   6) 页面切换 + 只持久化"当前页"
   7) 事件委托与初始化
   ========================================================= */

(function () {
  'use strict';

  /* =========================================================
     1. 工具与常量
     ========================================================= */

  // 名字只在这一个地方定义：标题、品牌、问候语、打卡标签都从它派生。
  // 换成别的名字时，改这一行 + index.html 里首屏兜底的那两处静态文字即可。
  const OWNER = '思洋';

  const PAGE_KEY = 'siyang:activePage';       // 只存当前选中页
  const PAGES = ['home', 'plan', 'todo', 'english', 'fitness', 'meal', 'checkin', 'media', 'memo'];

  const $  = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  const uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  };

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

  /* =========================================================
     2. 占位数据
     ========================================================= */

  /* 这份示例按思洋的真实节奏写：微积分 / 大英、网管会技术部、校工会数据统计部、
     日语、考研（数二 + 英语二）、20 个作品集项目、CSDN/知乎 两处更新。
     它只是"开箱能看懂"的样例，不是他的真实台账 —— 真数据在页面上直接增删改。 */
  const data = {
    plans: [
      { id: 'p1', time: '07:00 – 07:40', task: '起床 + 食堂早餐，顺一遍今天的课表',              tag: '生活' },
      { id: 'p2', time: '08:00 – 09:40', task: '微积分（上）· 计科 8 班 · 第二章 极限',          tag: '上课' },
      { id: 'p3', time: '10:00 – 11:40', task: '大学英语Ⅰ · 精读一篇 + 听力 15 分钟',            tag: '上课' },
      { id: 'p4', time: '14:30 – 17:00', task: '网管会技术部值班：打网线、跟进报障工单',          tag: '组织' },
      { id: 'p5', time: '19:00 – 20:30', task: '考研数学（数二）基础一节 + 英语二单词 40 个',     tag: '考研' },
      { id: 'p6', time: '20:40 – 21:40', task: '日语五十音 た行默写 / 写一篇技术笔记',            tag: '日语' }
    ],
    todos: [
      { id: 't1', text: '交微积分（上）第二章作业', done: true },
      { id: 't2', text: '背完考研英语二 Unit 3 的 40 个词', done: true },
      { id: 't3', text: '整理网管会值班记录，交本周报障统计', done: false },
      { id: 't4', text: '给作品集第 20 个项目补 README 和封面图', done: false },
      { id: 't5', text: '把《入党申请书》交给团支书', done: false },
      { id: 't6', text: '日语：五十音 あ行—た行 默写一遍', done: false }
    ],
    // 考研英语二的高频词，不是随便凑的
    words: [
      { id: 'w1', word: 'accumulate', phonetic: '/əˈkjuːmjəleɪt/', meaning: 'v. 积累；积聚' },
      { id: 'w2', word: 'discipline', phonetic: '/ˈdɪsəplɪn/',     meaning: 'n. 自律；纪律' },
      { id: 'w3', word: 'threshold',  phonetic: '/ˈθreʃhəʊld/',    meaning: 'n. 门槛；临界点' },
      { id: 'w4', word: 'efficiency', phonetic: '/ɪˈfɪʃnsi/',      meaning: 'n. 效率；功效' },
      { id: 'w5', word: 'revise',     phonetic: '/rɪˈvaɪz/',       meaning: 'v. 修改；复习' },
      { id: 'w6', word: 'persist',    phonetic: '/pəˈsɪst/',       meaning: 'v. 坚持；持续存在' }
    ],
    workouts: [
      { id: 'f1', name: '热身拉伸',  duration: '10 分钟', sets: '1 组',         note: '久坐敲代码，先把肩颈和髋打开' },
      { id: 'f2', name: '俯卧撑',    duration: '12 分钟', sets: '4 组 × 15 次',  note: '手肘别外张，胸口找地面' },
      { id: 'f3', name: '平板支撑',  duration: '6 分钟',  sets: '3 组 × 45 秒',  note: '腰别塌，收紧核心' },
      { id: 'f4', name: '操场慢跑',  duration: '25 分钟', sets: '3 公里',       note: '配速轻松，能正常说话' }
    ],
    meals: [
      { id: 'e1', meal: '早餐', menu: '食堂二楼：豆浆 + 水煮蛋 + 菜包',   kcal: '380', tag: '顶住早八' },
      { id: 'e2', meal: '午餐', menu: '一荤两素 + 半碗米饭（少油窗口）', kcal: '620', tag: '别吃太饱' },
      { id: 'e3', meal: '加餐', menu: '无糖酸奶 + 一个苹果',             kcal: '150', tag: '犯困前吃' },
      { id: 'e4', meal: '晚餐', menu: '番茄鸡蛋面 + 一份青菜',           kcal: '520', tag: '自习前吃完' }
    ],
    checkins: [
      { id: 'k1', text: '微积分第二章终于啃完了，题做得慢，但一步没跳。',  at: '今天 21:40' },
      { id: 'k2', text: '第一次独立打好一根网线，测通那一下挺爽。',        at: '昨天 20:15' },
      { id: 'k3', text: '考研英语二阅读错了一半，先不慌，慢慢磨。',        at: '前天 22:02' }
    ],
    media: [
      { id: 'm1', title: 'Python 爬虫：从登录态到手写 Cookie 的完整链路',        platform: 'CSDN', status: '已发布', views: 3260 },
      { id: 'm2', title: 'JS 加密逆向里我踩过的 5 个坑',                        platform: '知乎', status: '已发布', views: 8600 },
      { id: 'm3', title: '一个能跑的语音助手长什么样：18 个项目 + 102 条单测',   platform: 'CSDN', status: '撰写中', views: 0 },
      { id: 'm4', title: '民办本科自学 AI 的半年：我的真实路径',                 platform: '知乎', status: '构思中', views: 0 }
    ],
    memos: [
      { id: 'n1', time: '2026-09-21T16:00', text: '把《入党申请书》交给团支书' },
      { id: 'n2', time: '2026-09-22T09:30', text: '日语课：五十音 あ行—た行 随堂测' },
      { id: 'n3', time: '2026-09-23T19:00', text: '作品集第 20 个项目补 README + 封面图' },
      { id: 'n4', time: '2026-09-25T20:00', text: '查成都信息工程大学 2027 招生简章：专硕专业课自命题科目' }
    ]
  };

  // 每个列表用到的字段 + 必填项 + 该列表对应的渲染函数名
  const SCHEMA = {
    plans:    { fields: ['time', 'task', 'tag'],                 required: ['time', 'task'] },
    todos:    { fields: ['text'],                                required: ['text'] },
    words:    { fields: ['word', 'phonetic', 'meaning'],         required: ['word', 'meaning'] },
    workouts: { fields: ['name', 'duration', 'sets', 'note'],    required: ['name'] },
    meals:    { fields: ['meal', 'menu', 'kcal', 'tag'],         required: ['meal', 'menu'] },
    checkins: { fields: ['text'],                                required: ['text'] },
    media:    { fields: ['title', 'platform', 'status', 'views'], required: ['title'] },
    memos:    { fields: ['time', 'text'],                        required: ['text'] }
  };

  const FIELD_LABEL = {
    time: '时段', task: '要做的事', tag: '分类标签',
    text: '内容', word: '单词', phonetic: '音标', meaning: '释义',
    name: '项目名称', duration: '时长', sets: '组数', note: '备注',
    meal: '餐次', menu: '菜单', kcal: '热量',
    title: '内容标题', platform: '平台', status: '状态', views: '浏览量'
  };

  const QUOTES = [
    { text: '你不需要很厉害才能开始，你需要开始才会很厉害。',   from: '写给正在起步的' + OWNER },
    { text: '今天多背的四十个单词，都是明年多出来的一条路。',     from: '考研英语二 · 打基础阶段' },
    { text: '把小事做完，永远比把大事想完更有用。',               from: '每日打卡 · 给四年后的自己' }
  ];

  /* =========================================================
     3. 可复用 HTML 片段
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
     4. 渲染
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

  /* ---- 4.1 首页 ---- */

  function renderGreeting() {
    const now = new Date();
    const h = now.getHours();
    let part = '晚上好';
    let ico = '🌙';
    if (h < 6)       { part = '夜深了'; ico = '🌙'; }
    else if (h < 9)  { part = '早上好'; ico = '☀️'; }
    else if (h < 12) { part = '上午好'; ico = '🌤️'; }
    else if (h < 14) { part = '中午好'; ico = '🍚'; }
    else if (h < 18) { part = '下午好'; ico = '🌤️'; }
    else if (h < 23) { part = '晚上好'; ico = '🌙'; }

    const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    $('#greeting').textContent = part + '，' + OWNER + ' ' + ico;
    $('#today').textContent = now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月 ' + now.getDate() +
                              ' 日 · 星期' + week + ' · 今天也按自己的节奏来';
  }

  function renderStats() {
    const done = data.todos.filter(function (t) { return t.done; }).length;
    $('#stat-todo').textContent = data.todos.length;
    $('#stat-done').textContent = done;
    $('#stat-checkin').textContent = data.checkins.length;
    $('#stat-word').textContent = data.words.length;
  }

  function renderQuotes() {
    $('#quotes').innerHTML = QUOTES.map(function (q) {
      return '<figure class="quote">' +
               '<blockquote class="quote__text">' + esc(q.text) + '</blockquote>' +
               '<figcaption class="quote__from">' + esc(q.from) + '</figcaption>' +
             '</figure>';
    }).join('');
  }

  /* ---- 4.2 每日计划 ---- */

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

  /* ---- 4.3 待办清单 ---- */

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

  /* ---- 4.4 英语学习 ---- */

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

  /* ---- 4.5 锻炼身体 ---- */

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

  /* ---- 4.6 好好吃饭 ---- */

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

  /* ---- 4.7 每日打卡 ---- */

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

  /* ---- 4.8 自媒体 ---- */

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

  /* ---- 4.9 备忘录 ---- */

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
     5. 增 / 删 / 改 / 勾选
     ========================================================= */

  // 各页"添加"表单的提交规则
  const FORM_RULES = {
    plan:    { list: 'plans',    required: ['time', 'task'],
               make: function (v) { return { id: uid(), time: v.time, task: v.task, tag: v.tag || '未分类' }; } },
    todo:    { list: 'todos',    required: ['text'],
               make: function (v) { return { id: uid(), text: v.text, done: false }; } },
    word:    { list: 'words',    required: ['word', 'meaning'],
               make: function (v) { return { id: uid(), word: v.word, phonetic: v.phonetic, meaning: v.meaning }; } },
    workout: { list: 'workouts', required: ['name'],
               make: function (v) { return { id: uid(), name: v.name, duration: v.duration, sets: v.sets, note: v.note }; } },
    meal:    { list: 'meals',    required: ['meal', 'menu'],
               make: function (v) { return { id: uid(), meal: v.meal, menu: v.menu, kcal: v.kcal, tag: v.tag }; } },
    checkin: { list: 'checkins', required: ['text'],
               make: function (v) { return { id: uid(), text: v.text, at: stamp() }; } },
    media:   { list: 'media',    required: ['title'],
               make: function (v) { return { id: uid(), title: v.title, platform: v.platform, status: v.status, views: Number(v.views) || 0 }; } },
    memo:    { list: 'memos',    required: ['text'],
               make: function (v) { return { id: uid(), time: v.time || nowLocal(), text: v.text }; } }
  };

  function stamp() {
    const d = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

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

  // 添加
  function handleSubmit(form) {
    const rule = FORM_RULES[form.dataset.form];
    if (!rule) return;

    const v = {};
    $$('[name]', form).forEach(function (el) { v[el.name] = el.value.trim(); });

    const missing = rule.required.filter(function (f) { return !v[f]; });
    if (missing.length) {
      showToast('请先填写：' + missing.map(function (f) { return labelOf(form, f); }).join('、'));
      const first = form.querySelector('[name="' + missing[0] + '"]');
      if (first) first.focus();
      return;
    }

    data[rule.list].unshift(rule.make(v));
    form.reset();

    // 备忘录的时间：重置后自动填回"现在"，省掉一次手输
    if (form.dataset.form === 'memo') {
      const t = form.querySelector('[name="time"]');
      if (t) t.value = nowLocal();
    }

    renderAll();
    showToast('已添加 ✓');
  }

  // 保存编辑
  function handleSave(btn) {
    const list = btn.dataset.list;
    const id = btn.dataset.id;
    const row = btn.closest('[data-row]');
    const item = findItem(list, id);
    if (!row || !item) return;

    const v = {};
    $$('[data-field]', row).forEach(function (el) { v[el.dataset.field] = el.value.trim(); });

    const missing = (SCHEMA[list].required || []).filter(function (f) { return !v[f]; });
    if (missing.length) {
      showToast('「' + (FIELD_LABEL[missing[0]] || missing[0]) + '」不能为空');
      const first = row.querySelector('[data-field="' + missing[0] + '"]');
      if (first) first.focus();
      return;
    }

    Object.assign(item, v);
    // 字段级收尾：数值字段存数字、计划标签留个兜底
    if (list === 'media') item.views = Number(v.views) || 0;
    if (list === 'plans' && !item.tag) item.tag = '未分类';

    editing = null;
    renderAll();
    showToast('已保存 ✓');
  }

  // 删除（两段式：先变成"确认删除"，3 秒内再点一次才真删）
  function handleDelete(btn) {
    const list = btn.dataset.list;
    const id = btn.dataset.id;

    if (pending && pending.list === list && pending.id === id) {
      data[list] = data[list].filter(function (x) { return x.id !== id; });
      pending = null;
      editing = null;
      clearTimeout(pendingTimer);
      renderAll();
      showToast('已删除');
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
      if (!cb) return;
      const list = cb.dataset.toggle;
      const item = findItem(list, cb.dataset.id);
      if (!item) return;
      item.done = cb.checked;
      renderAll();
      showToast(cb.checked ? '完成一件 ✓' : '已取消勾选');
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
    // 把 OWNER 同步到静态 HTML：index.html 里那份是首屏兜底，这里是"改名不会漏"的保险。
    // 之所以两处都写，是因为页面要能在 JS 加载前就显示出正确的名字。
    document.title = OWNER + ' · 个人管理台';
    const brandMark = document.querySelector('.brand__mark');
    const brandName = document.querySelector('.brand__text strong');
    if (brandMark) brandMark.textContent = OWNER.charAt(0);
    if (brandName) brandName.textContent = OWNER + '管理台';

    renderAll();
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
