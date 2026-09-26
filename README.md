# 思洋 · 个人管理台

把一套写死的静态待办页面，改造成 **Flask + SQLite 的多用户 Web 应用**。

---

## 从哪来

原型是一个纯静态页面：数据以常量数组写在 JS 里，**刷新即还原**，没有用户概念，也没有后端。

改造原则是 **原地改造，不重写** —— 原有 HTML 结构、CSS 规则、JS 交互逻辑全部保留，只做增量。所以改造后的视觉与交互跟原型完全一致，换掉的只是底下那层数据。

---

## 改造内容

| 项 | 改造前 | 改造后 |
|---|---|---|
| 数据存储 | JS 里的常量数组，刷新还原 | SQLite 文件落盘持久化 |
| 数据访问 | 直接读内存对象 | Flask-SQLAlchemy 完整 CRUD |
| 用户体系 | 无 | `users` 表 + 注册 / 登录 / 退出，密码哈希存储 |
| 数据归属 | 无 | 每张业务表带 `user_id` 外键，多用户天然隔离 |
| 运行方式 | `app.run()` 开发服务器 | gunicorn + systemd 常驻，开机自启 |
| 接口 | 只有读取 | 获取全部 / 按 id 查 / 新增 / 修改 / 删除，五套齐全 |

---

## 核心设计：`LIST_REGISTRY` 注册表

9 个业务列表（每日计划 / 待办 / 语录 / 运动 / 饮食 / 打卡 / 媒体 / 备忘 / 金句）的字段类型、必填项、默认值、排序规则，全部集中在一张注册表里描述：

```python
LIST_REGISTRY = {
    "plans": {
        "model": Plan,
        "title": "每日计划",
        "fields": {"time": "str", "task": "str", "tag": "str"},
        "required": ["time", "task"],
        "defaults": {"tag": "未分类"},
        "order": ("start_minutes", "asc"),
    },
    # ... 其余 8 个同构
}
```

**好处**：新增一个列表只需加一条配置，**五套 CRUD 接口一行都不用改**。

---

## 技术栈

`Flask 3.1.3` · `Flask-SQLAlchemy 3.1.1` · `SQLAlchemy 2.0.54` · `SQLite` · 原生 JS（无前端框架）

---

## 运行

```bash
pip install -r requirements.txt
python app.py          # 默认 5111 端口
```

首次启动会**自动建表**（模块级调用 `init_database()`）。

> ⚠️ 因为建表是模块级执行的，部署时**必须单进程**（`gunicorn -w 1`）—— 多 worker 会并发建表撞车报 `table already exists`。SQLite 本身是库级写锁，单进程也更合适。

`simon.db` 是运行时生成的数据库文件，不在版本控制里。

---

## 配置

| 环境变量 | 说明 |
|---|---|
| `SECRET_KEY` | session 签名密钥。**部署到公网前必须设置**，否则别人拿到源码就能伪造登录态 |
| `FLASK_DEBUG` | 生产环境必须是 `0`，否则调试器会把源码暴露到浏览器 |

---

## 接口

**页面**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 首页。未登录 → 302 跳 `/login` |
| GET | `/login` | 登录 / 注册页 |
| GET | `/logout` | 退出登录并跳回登录页 |

**认证**

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | `{username, password, password2}` | 注册并自动登录。用户名 2–20 位、密码 ≥6 位、两次一致、重名拒绝 |
| POST | `/api/auth/login` | `{username, password}` | 登录，写入 session |
| POST | `/api/auth/logout` | — | 退出 |
| GET | `/api/auth/me` | — | 返回当前登录用户；未登录 401 |

**数据**（`<list_name>` 取注册表里的 9 个名字之一）

| 方法 | 路径 | 对应操作 |
|---|---|---|
| GET | `/api/data` | 一次拿全：引导信息 + 所有列表 + 语录 |
| GET | `/api/<list_name>` | 获取全部 |
| GET | `/api/<list_name>/<id>` | 按 id 单查 |
| POST | `/api/<list_name>` | 新增 |
| PUT | `/api/<list_name>/<id>` | 修改 |
| DELETE | `/api/<list_name>/<id>` | 删除 |

---

## 测试

`test_api.py` 覆盖登录态、五套 CRUD、排序、多用户隔离。

```bash
python app.py &                                  # 起服务
python test_api.py                               # 默认打本机 5111
BASE_URL=http://127.0.0.1:5000 python test_api.py
```

⚠️ 脚本会**真的往数据库写数据**（新建测试账号 + 改动演示账号的待办）。跑完想恢复干净数据，删掉 `simon.db` 重启即可。

⚠️ Windows 上如果设了 `HTTP_PROXY`，脚本里已显式禁用代理 —— 否则 `127.0.0.1` 的请求会被发到代理上去，报 502。

---

## 目录结构

```
siyang-manager/
├── app.py                  # 主程序（1179 行）
├── requirements.txt
├── test_api.py             # 接口自测
├── 交付说明.md              # 完整部署记录（含 systemd 配置与排查过程）
│
├── templates/
│   ├── index.html          # 首页（增量修改）
│   └── login.html          # 登录 / 注册页（新增）
│
├── static/
│   ├── css/style.css       # 样式（末尾追加登录页样式）
│   └── js/
│       ├── app.js          # 首页逻辑（加了 401 跳转）
│       └── auth.js         # 登录页逻辑（新增）
│
└── legacy/                 # 改造前的纯静态版，仅供对照
    ├── index.html
    ├── app.js
    └── style.css
```

---

部署到 Ubuntu 服务器（sync 代码 → 建 venv → systemd 常驻 → 云安全组放行）的完整过程与踩坑记录，见 **`交付说明.md`**。
