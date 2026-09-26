/* =========================================================
   思洋 · 个人管理台 —— 登录 / 注册页脚本
   ---------------------------------------------------------
   只做三件事：
     1) 顶部两个 tab 之间切换（登录 / 注册）
     2) 把表单内容 POST 给后端接口
     3) 成功就跳首页，失败就把后端那句「人话错因」弹出来

   成功/失败的判定完全交给后端，前端不自己猜 ——
   和主页 app.js 的思路保持一致。
   ========================================================= */

(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  // ⚠️ root 参数不能省：下面读表单字段时要限定在 <form> 范围内查找。
  // 少了它就会变成全文档查找，`[name]` 会命中 <meta name="viewport"> 这类
  // 有 name 属性、却没有 value 属性的元素，直接抛 TypeError。
  // 签名与 app.js 里那个 $$ 保持一致。
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function showToast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.classList.remove('is-on'); }, 2600);
  }

  /* ---------- 1. tab 切换 ---------- */
  function switchTab(name) {
    $$('.auth__tab').forEach(function (tab) {
      var on = tab.dataset.tab === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#form-login').hidden = name !== 'login';
    $('#form-register').hidden = name !== 'register';

    // 切过去就把焦点送进第一个输入框，键盘用户不用再 Tab 一次
    var first = $('#' + (name === 'login' ? 'form-login' : 'form-register') + ' input');
    if (first) first.focus();
  }

  /* ---------- 2. 提交 ---------- */
  function submit(form) {
    var isRegister = form.dataset.form === 'register';

    // 取表单里所有 [name] 的输入框，拼成要发的 JSON
    var payload = {};
    $$('[name]', form).forEach(function (el) { payload[el.name] = el.value.trim(); });

    // 本地先拦一道空值（只为少等一次网络往返，后端还会再校验一次）
    if (!payload.username) { showToast('请先填写用户名'); return; }
    if (!payload.password) { showToast('请先填写密码'); return; }
    if (isRegister) {
      if (!payload.password2) { showToast('请再输一遍密码'); return; }
      if (payload.password !== payload.password2) { showToast('两次输入的密码不一致'); return; }
    }

    var url = isRegister ? '/api/auth/register' : '/api/auth/login';
    var button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;      // 防止连点造成重复提交

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () {
          throw new Error('服务端返回了无法解析的内容（HTTP ' + res.status + '）');
        }).then(function (json) {
          if (!res.ok || !json.ok) throw new Error(json.error || ('请求失败（HTTP ' + res.status + '）'));
          return json;
        });
      })
      .then(function (json) {
        showToast(isRegister ? '注册成功，正在进入…' : '登录成功，正在进入…');
        // redirect 由后端给（现在是 "/"），前端不写死跳转目标
        window.location.href = json.redirect || '/';
      })
      .catch(function (err) {
        if (err instanceof TypeError) err = new Error('连不上后端，确认 python app.py 还在跑');
        showToast(err.message);
        if (button) button.disabled = false;   // 失败了要能再点一次
      });
  }

  /* ---------- 3. 绑定 ---------- */
  function init() {
    $$('.auth__tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
    });

    document.addEventListener('submit', function (e) {
      var form = e.target.closest('form[data-form]');
      if (!form) return;
      e.preventDefault();        // 关键：阻止浏览器默认提交，页面不刷新
      submit(form);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
