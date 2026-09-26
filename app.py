# -*- coding: utf-8 -*-
"""
思洋 · 个人管理台 —— Flask 后端（SQLite + Flask-SQLAlchemy 版）
====================================================================
这个文件是整个应用的「唯一数据源」：页面上看到的每一个字，
问候语、统计数字、9 个导航页的列表内容，都从这里发出去。

和上一版的区别（重要）：
    上一版把数据写在 Python 字典里（进程内存），Ctrl+C 一停就回到初始示例。
    这一版全部落到 SQLite 数据库文件 simon.db，关掉服务、重启电脑，数据都还在。

设计上做四件事：
    1) 用 SQLAlchemy 模型描述 9 张业务表 + 1 张用户表（字段 = 上一版字典的键）
    2) 用一份「注册表」(LIST_REGISTRY) 描述每张表怎么校验、怎么排序，
       这样 8 个列表共用同一套增删改查接口，不用写 8 遍
    3) 提供 REST 接口：获取全部 / 按 id 查询 / 新增 / 修改 / 删除
    4) 提供注册、登录、退出接口，用 Flask session 记住「现在是谁」

启动方式：
    cd jiajia
    pip install -r requirements.txt
    python app.py
    浏览器打开 http://127.0.0.1:5000  （未登录会自动跳到 /login）

首次运行会自动建表并灌入一份示例数据（挂在演示账号下），
新注册的账号是干净的、没有任何模拟数据 —— 这是需求里明确要求的。
"""

import os
import re
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, g, jsonify, redirect, render_template, request,
                   session, url_for)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import validates
from werkzeug.security import check_password_hash, generate_password_hash

# ====================================================================
# 〇、应用与数据库配置
# ====================================================================

# 用绝对路径拼数据库位置：无论从哪个目录启动，simon.db 都生成在 jiajia 项目目录里
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "simon.db")

app = Flask(__name__)

# SQLite 连接串。三斜杠表示「相对路径」，这里我们给了绝对路径，
# 所以要把 Windows 的反斜杠换成正斜杠，SQLAlchemy 才认。
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + DB_PATH.replace("\\", "/")

# 关掉「对象一改就发信号」的追踪：这个功能只在 Flask-SQLAlchemy 的老教程里有用，
# 开着只会白白吃内存，官方也建议关闭。
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# session（登录凭证）的签名密钥。生产环境务必用环境变量覆盖，
# 否则别人拿到源码就能伪造登录态。
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "siyang-todo-dev-secret-key")

db = SQLAlchemy(app)


# ====================================================================
# 一、数据模型（表结构）
# ====================================================================
#
# 每张业务表都挂一个 user_id 外键 —— 这是「多用户」的关键：
# 查询时永远带上 user_id，A 用户看不到也改不了 B 用户的数据。
#
# 另外注意：模型里的字段名和上一版字典的键一一对应，
# 这样原有前端（app.js / index.html）一行都不用改就能继续用。

# ---- 1.1 用户表 ----
class User(db.Model):
    """用户。密码只存哈希，不存明文 —— 数据库被看到也拿不到原密码。"""

    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(32), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

    def set_password(self, raw_password):
        """把明文密码转成哈希再存。每次加盐，同一个密码两次结果也不同。"""
        self.password_hash = generate_password_hash(raw_password)

    def check_password(self, raw_password):
        """校验密码。比对的是哈希，永远不会把明文写进日志或数据库。"""
        return check_password_hash(self.password_hash, raw_password)

    def to_dict(self):
        """给前端看的版本：绝不含 password_hash。"""
        return {"id": str(self.id), "username": self.username}

    def __repr__(self):
        return f"<User {self.id} {self.username}>"


# ---- 1.2 业务表公共部分 ----
class OwnedModel(db.Model):
    """
    「属于某个用户」的表都继承这个抽象基类。
    __abstract__ = True 表示它自己不建表，只把字段借给子类。
    """

    __abstract__ = True

    id = db.Column(db.Integer, primary_key=True)
    # index=True：查询永远带 user_id 过滤，加索引才不会全表扫
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)


# ====================================================================
# ⚠️ 关于 to_dict() 里为什么写 str(self.id) —— 别改回 self.id
# ====================================================================
#
# 数据库主键是 Integer，直接输出会变成 JSON 数字（"id": 8）。
# 但前端 app.js 里所有 id 都是从 DOM 属性上读回来的：
#
#     editing = { id: btn.dataset.id }        // ← 一定是字符串 "8"
#     data[list].filter(x => x.id === id)      // ← 严格相等，数字 8 永远匹配不上
#     pending.id === id                        // ← 同上，删除确认态也进不去
#
# 也就是说「字符串 id」才是前后端之间既有的约定。后端给数字，就会出现：
# 点「编辑」没反应、点「删除」不进入确认态 —— 而且不报任何错，最难查。
#
# 所以对外暴露的 id 一律 str() 一次。前端因此一行都不用改。
#
# 注意：这只影响「发出去给浏览器」的数据。后端内部（路由 <int:item_id>、
# query.get()、外键 user_id）走的仍然是整数，两边互不干扰。
# ====================================================================


# ---- 1.3 每日计划 ----
# 排序用的时间：把 "07:00 – 07:40" 里的 07:00 换算成分钟数存下来。
# 这样「按时间升序」可以交给数据库做（ORDER BY），不用把数据全查出来在 Python 里排。
_TIME_RE = re.compile(r"(\d{1,2})\s*[:：]\s*(\d{1,2})")


def plan_time_key(text):
    """
    从时段文本里抠出开始时间，换算成「当天第几分钟」。
    '07:00 – 07:40' -> 420
    解析不出来的（比如用户只写了「上午」）统一排到最后面。
    """
    match = _TIME_RE.search(text or "")
    if not match:
        return 24 * 60 + 1
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return 24 * 60 + 1
    return hour * 60 + minute


class Plan(OwnedModel):
    """每日计划：时段 + 要做的事 + 分类标签。"""

    __tablename__ = "plans"

    time = db.Column(db.String(40), nullable=False)      # "07:00 – 07:40"
    task = db.Column(db.String(200), nullable=False)     # 要做的事
    tag = db.Column(db.String(20), default="未分类")      # 上课 / 组织 / 考研……
    start_minutes = db.Column(db.Integer, nullable=False, default=24 * 60 + 1, index=True)

    @validates("time")
    def _sync_start_minutes(self, key, value):
        """
        只要有人给 time 赋值，就顺手把排序字段算好。
        用 @validates 而不是在每个接口里手动算 —— 这样新增、修改、
        甚至以后在控制台里直接改数据，都不会漏掉这一层同步。
        """
        self.start_minutes = plan_time_key(value)
        return value

    def to_dict(self):
        return {
            "id": str(self.id),
            "time": self.time,
            "task": self.task,
            "tag": self.tag or "未分类",
        }


# ---- 1.4 待办清单 ----
class Todo(OwnedModel):
    __tablename__ = "todos"

    text = db.Column(db.String(200), nullable=False)
    done = db.Column(db.Boolean, nullable=False, default=False)

    def to_dict(self):
        # 数据库里是 0/1，JSON 里统一给真正的布尔值，前端才好判断
        return {"id": str(self.id), "text": self.text, "done": bool(self.done)}


# ---- 1.5 英语单词 ----
class Word(OwnedModel):
    __tablename__ = "words"

    word = db.Column(db.String(60), nullable=False)
    phonetic = db.Column(db.String(60), default="")       # 音标，可空
    meaning = db.Column(db.String(200), nullable=False)

    def to_dict(self):
        return {
            "id": str(self.id),
            "word": self.word,
            "phonetic": self.phonetic or "",
            "meaning": self.meaning,
        }


# ---- 1.6 锻炼身体 ----
class Workout(OwnedModel):
    __tablename__ = "workouts"

    name = db.Column(db.String(60), nullable=False)       # 项目名称
    duration = db.Column(db.String(30), default="")       # 时长，可空
    sets = db.Column(db.String(30), default="")           # 组数，可空
    note = db.Column(db.String(200), default="")          # 备注 / 要领

    def to_dict(self):
        return {
            "id": str(self.id),
            "name": self.name,
            "duration": self.duration or "",
            "sets": self.sets or "",
            "note": self.note or "",
        }


# ---- 1.7 好好吃饭 ----
class Meal(OwnedModel):
    __tablename__ = "meals"

    meal = db.Column(db.String(20), nullable=False)       # 早餐 / 午餐 / 晚餐 / 加餐
    menu = db.Column(db.String(200), nullable=False)
    # 热量沿用字符串：页面上「380 kcal」是直接拼字显示，而且允许留空，
    # 换成数字列反而要处理「没填」和「0」的区别，得不偿失。
    kcal = db.Column(db.String(20), default="")
    tag = db.Column(db.String(20), default="")            # 减脂 / 高蛋白……

    def to_dict(self):
        return {
            "id": str(self.id),
            "meal": self.meal,
            "menu": self.menu,
            "kcal": self.kcal or "",
            "tag": self.tag or "",
        }


# ---- 1.8 每日打卡 ----
class Checkin(OwnedModel):
    __tablename__ = "checkins"

    text = db.Column(db.String(300), nullable=False)
    # 存「发生的时刻」（真正的 datetime），展示时才换算成「今天 21:40」。
    # 存原始值 + 出口再格式化，好处是过了零点刷新页面，它会自己从「今天」变「昨天」。
    at = db.Column(db.DateTime, nullable=False, default=datetime.now, index=True)

    def to_dict(self):
        return {"id": str(self.id), "text": self.text, "at": relative_day_text(self.at)}


# ---- 1.9 自媒体 ----
class Media(OwnedModel):
    __tablename__ = "media"

    title = db.Column(db.String(200), nullable=False)
    platform = db.Column(db.String(20), default="CSDN")
    status = db.Column(db.String(10), default="构思中")
    views = db.Column(db.Integer, nullable=False, default=0)

    def to_dict(self):
        return {
            "id": str(self.id),
            "title": self.title,
            "platform": self.platform or "CSDN",
            "status": self.status or "构思中",
            "views": int(self.views or 0),   # 存的是数字，前端还要按万位缩写
        }


# ---- 1.10 备忘录 ----
class Memo(OwnedModel):
    __tablename__ = "memos"

    time = db.Column(db.DateTime, nullable=False, default=datetime.now, index=True)
    text = db.Column(db.String(300), nullable=False)

    def to_dict(self):
        # 出口转成 datetime-local 认的格式："2026-09-21T16:00"
        return {"id": str(self.id), "time": iso_local(self.time), "text": self.text}


# ---- 1.11 励志语录（全局共享，不属于任何用户）----
class Quote(db.Model):
    """
    首页「今日能量」那三句话。
    特意不挂 user_id：它是应用给的鼓励，不是某个人的数据 ——
    所以新注册的用户首页依然有「今日份鼓励语句」（需求里点名要保留的）。
    """

    __tablename__ = "quotes"

    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(200), nullable=False)
    # from 是 Python 关键字，列名用 source；对外输出的 JSON 键仍然叫 from，
    # 这样前端 renderQuotes() 不用改。
    source = db.Column(db.String(100), default="")
    # 显示顺序：语录句数少，给个显式序号，比按 id 排更可控
    sort_no = db.Column(db.Integer, nullable=False, default=0)

    def to_dict(self):
        return {"id": str(self.id), "text": self.text, "from": self.source or ""}


# ====================================================================
# 二、时间小工具
# ====================================================================

def _now():
    """统一取「当前时间」的入口，方便以后要改成固定时间测试。"""
    return datetime.now()


def iso_local(dt):
    """datetime -> '2026-09-22T21:40'（datetime-local 输入框认这个格式）"""
    if dt is None:
        return ""
    return dt.strftime("%Y-%m-%dT%H:%M")


def relative_day_text(dt):
    """把时刻说成人话：'今天 21:40' / '昨天 20:15' / '9月19日 22:02'"""
    if dt is None:
        return ""
    days = (_now().date() - dt.date()).days
    if days == 0:
        day = "今天"
    elif days == 1:
        day = "昨天"
    elif days == 2:
        day = "前天"
    else:
        day = f"{dt.month}月{dt.day}日"
    return f"{day} {dt.strftime('%H:%M')}"


def parse_local_dt(value):
    """
    把前端传来的时间字符串解析成 datetime。
    兼容 datetime-local 的 '2026-09-21T16:00'、带秒的、以及空格分隔的写法；
    解析不了就返回 None（调用方会跳过赋值，不会写坏数据）。
    """
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip().replace("/", "-")
    if not text:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


# ====================================================================
# 三、列表注册表：每张表「能写哪些字段、哪些必填、怎么排」
# ====================================================================
#
# 这就是这套代码的省事之处：8 个列表共用同一套接口实现，
# 想加一个字段、改一条排序规则，只动这张表，接口一行都不用碰。
#
#   model           —— 对应的 SQLAlchemy 模型
#   title           —— 报错时用的中文名
#   fields          —— 允许写入的字段白名单 + 字段类型
#   required        —— 必填字段（服务端校验才是真正的守门人）
#   defaults        —— 空值兜底（空字符串也算空）
#   create_defaults —— 只在新增时盖章，比如打卡时间由服务端说了算
#   order           —— （列名, "asc"/"desc"）
#   shared          —— True 表示全局数据，不按用户隔离
#   aliases         —— 对外 API 名 -> 数据库列名（目前只有 quotes 的 from）

LIST_REGISTRY = {
    "plans": {
        "model": Plan,
        "title": "每日计划",
        "fields": {"time": "str", "task": "str", "tag": "str"},
        "required": ["time", "task"],
        "defaults": {"tag": "未分类"},
        # 需求第 9 条：每日计划按时间升序。start_minutes 是 time 的派生列，
        # 同类时间再按 id 升序，保证顺序稳定（不会每次刷新换个样）。
        "order": ("start_minutes", "asc"),
    },
    "todos": {
        "model": Todo,
        "title": "待办清单",
        "fields": {"text": "str", "done": "bool"},
        "required": ["text"],
        "order": ("id", "desc"),
    },
    "words": {
        "model": Word,
        "title": "英语单词",
        "fields": {"word": "str", "phonetic": "str", "meaning": "str"},
        "required": ["word", "meaning"],
        "order": ("id", "desc"),
    },
    "workouts": {
        "model": Workout,
        "title": "锻炼项目",
        "fields": {"name": "str", "duration": "str", "sets": "str", "note": "str"},
        "required": ["name"],
        "order": ("id", "desc"),
    },
    "meals": {
        "model": Meal,
        "title": "食谱",
        "fields": {"meal": "str", "menu": "str", "kcal": "str", "tag": "str"},
        "required": ["meal", "menu"],
        "order": ("id", "desc"),
    },
    "checkins": {
        "model": Checkin,
        "title": "打卡记录",
        # at 不在白名单里：打卡时间由服务端盖章，前端说了不算
        "fields": {"text": "str"},
        "required": ["text"],
        "create_defaults": {"at": datetime.now},
        "order": ("at", "desc"),
    },
    "media": {
        "model": Media,
        "title": "自媒体选题",
        "fields": {"title": "str", "platform": "str", "status": "str", "views": "int"},
        "required": ["title"],
        "defaults": {"platform": "CSDN", "status": "构思中", "views": 0},
        "order": ("id", "desc"),
    },
    "memos": {
        "model": Memo,
        "title": "备忘录",
        "fields": {"time": "datetime", "text": "str"},
        "required": ["text"],
        "create_defaults": {"time": datetime.now},
        "order": ("time", "asc"),
    },
    "quotes": {
        "model": Quote,
        "title": "励志语录",
        "shared": True,                       # 全局共享，不按用户隔离
        "fields": {"text": "str", "source": "str"},
        "required": ["text"],
        "defaults": {"source": ""},
        "aliases": {"from": "source"},        # 前端仍可以传 "from"
        "order": ("sort_no", "asc"),
    },
}

# 报错时要说人话：「请先填写：时段、要做的事」而不是「missing field: time」
FIELD_LABEL = {
    "time": "时段", "task": "要做的事", "tag": "分类标签",
    "text": "内容", "word": "单词", "phonetic": "音标", "meaning": "释义",
    "name": "项目名称", "duration": "时长", "sets": "组数", "note": "备注",
    "meal": "餐次", "menu": "菜单", "kcal": "热量",
    "title": "内容标题", "platform": "平台", "status": "状态", "views": "浏览量",
    "source": "出处", "from": "出处",
}

# 导航菜单留在代码里，不进数据库：它是「界面骨架」而不是「用户数据」，
# 存进数据库只会让部署时多一步导入，没有任何好处。
NAV = [
    {"key": "home",    "icon": "🏠", "label": "首页仪表盘"},
    {"key": "plan",    "icon": "📅", "label": "每日计划"},
    {"key": "todo",    "icon": "📋", "label": "待办清单"},
    {"key": "english", "icon": "📚", "label": "英语学习"},
    {"key": "fitness", "icon": "💪", "label": "锻炼身体"},
    {"key": "meal",    "icon": "🍱", "label": "好好吃饭"},
    {"key": "checkin", "icon": "✍️", "label": "每日打卡"},
    {"key": "media",   "icon": "📱", "label": "自媒体"},
    {"key": "memo",    "icon": "📝", "label": "备忘录"},
]


# ====================================================================
# 四、登录态：谁在访问？
# ====================================================================

@app.before_request
def load_current_user():
    """
    每个请求进来先做一件事：把 session 里的 user_id 还原成 User 对象，放进 g。
    g 是「本次请求期间有效」的容器，视图函数里直接 g.user 就能拿到当前用户。

    放在 before_request 里而不是每个视图里各查一次，
    是因为「当前用户」几乎每个接口都要用，查一次就够。
    """
    g.user = None
    user_id = session.get("user_id")
    if user_id:
        g.user = db.session.get(User, user_id)
        # 用户被删了但浏览器还揣着旧 session —— 清理掉，别让后续逻辑拿到死数据
        if g.user is None:
            session.clear()


def login_required_api(view):
    """
    接口级登录校验。未登录返回 401 + JSON。
    前端 app.js 收到 401 会自动跳登录页，所以这里必须是 JSON 而不是重定向。
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return jsonify({"ok": False, "error": "登录状态已失效，请重新登录"}), 401
        return view(*args, **kwargs)

    return wrapper


# ====================================================================
# 五、首页仪表盘要用的聚合数据
# ====================================================================

def build_greeting(now, username):
    """按小时算问候语。这里用的是「登录的用户名」，不是写死的名字。"""
    hour = now.hour
    if hour < 6:
        part, icon = "夜深了", "🌙"
    elif hour < 9:
        part, icon = "早上好", "☀️"
    elif hour < 12:
        part, icon = "上午好", "🌤️"
    elif hour < 14:
        part, icon = "中午好", "🍚"
    elif hour < 18:
        part, icon = "下午好", "🌤️"
    elif hour < 23:
        part, icon = "晚上好", "🌙"
    else:
        part, icon = "夜深了", "🌙"
    return f"{part}，{username} {icon}"


def build_date_text(now):
    """'2026 年 9 月 22 日 · 星期二 · 今天也按自己的节奏来'"""
    week = ["日", "一", "二", "三", "四", "五", "六"][now.isoweekday() % 7]
    return (f"{now.year} 年 {now.month} 月 {now.day} 日 · 星期{week}"
            f" · 今天也按自己的节奏来")


def build_stats():
    """
    首页那 4 个数字。统计口径放后端，改口径不用动前端。
    全部带 user_id 过滤 —— 只统计「当前登录用户」的，人数再多也不会串。
    """
    if g.user is None:
        return {"todo": 0, "done": 0, "checkin": 0, "word": 0}
    uid = g.user.id
    return {
        "todo": Todo.query.filter_by(user_id=uid).count(),                    # 今日待办（总数）
        "done": Todo.query.filter(Todo.user_id == uid, Todo.done.is_(True)).count(),  # 已完成
        "checkin": Checkin.query.filter_by(user_id=uid).count(),              # 打卡记录
        "word": Word.query.filter_by(user_id=uid).count(),                    # 今日单词
    }


def query_all(rule):
    """
    查某张表「当前用户的全部记录」，并按注册表里的规则排序。
    filter_by(user_id=...) 这一步是数据隔离的落点。
    """
    model = rule["model"]
    query = model.query
    if not rule.get("shared"):
        query = query.filter_by(user_id=g.user.id)

    order = rule.get("order")
    if order:
        column_name, direction = order
        column = getattr(model, column_name)
        if column_name == "start_minutes":
            # 每日计划：主排序按开始时间升序，同时间再按 id 升序（顺序稳定）
            return query.order_by(column.asc(), model.id.asc()).all()
        return query.order_by(column.asc() if direction == "asc" else column.desc()).all()
    return query.order_by(model.id.desc()).all()


def build_boot():
    """
    打包一份「前端需要的全部数据」。
    页面首屏由它渲染，之后每次增删改查也返回一份新的它 ——
    前端拿到就直接整体重绘，永远不用自己猜「现在服务端是什么状态」。
    """
    now = _now()
    username = g.user.username if g.user else ""
    return {
        "user":      g.user.to_dict() if g.user else None,
        # owner = 登录用户名。首页标题、侧栏品牌、打卡的 @ 都从它派生，
        # 所以「换成登录的用户名」只需要改这一处。
        "owner":     username,
        "greeting":  build_greeting(now, username),
        "date_text": build_date_text(now),
        "nav":       NAV,
        "quotes":    [q.to_dict() for q in query_all(LIST_REGISTRY["quotes"])],
        "stats":     build_stats(),
        "lists": {
            name: [obj.to_dict() for obj in query_all(rule)]
            for name, rule in LIST_REGISTRY.items()
            if name != "quotes"      # 语录单独放在 quotes 字段里，不重复塞进 lists
        },
    }


# ====================================================================
# 六、页面路由
# ====================================================================

@app.route("/")
def index():
    """
    首页。已登录才放行，否则跳登录页。
    用 Flask 的模板功能把数据交给页面：render_template 会把 boot 塞进 index.html，
    模板里可以用 {{ boot.xxx }} 直接取值、用 {% for %} 循环生成导航按钮和语录。
    """
    if g.user is None:
        return redirect(url_for("login_page"))
    return render_template("index.html", boot=build_boot())


@app.route("/login")
def login_page():
    """登录 / 注册页。已经登录的人再点进来，直接送回首页。"""
    if g.user is not None:
        return redirect(url_for("index"))
    return render_template("login.html", demo_user=DEMO_USERNAME)


@app.route("/logout")
def logout():
    """退出登录：清空 session 后回登录页。侧栏那个「退出」按钮直接链到这里。"""
    session.clear()
    return redirect(url_for("login_page"))


# ====================================================================
# 七、接口统一返回格式
# ====================================================================
#
#     成功 -> {"ok": true,  "boot": {...}, "item": {...}}   HTTP 200
#     失败 -> {"ok": false, "error": "人话描述的错因"}       HTTP 400 / 401 / 404
#
# 每次写操作都带回完整的 boot，前端收到后 applyBoot() 一次重绘，
# 省掉「改完之后再拉一次全量数据」的第二次请求。

def _fail(message, code=400):
    return jsonify({"ok": False, "error": message}), code


def _ok(rule=None, item=None):
    payload = {"ok": True, "boot": build_boot()}
    if rule is not None and item is not None:
        payload["item"] = item.to_dict()
    return jsonify(payload)


def _rule_or_none(list_name):
    """取注册表里的一条规则；表名不认识就返回 None，调用方回 404。"""
    return LIST_REGISTRY.get(list_name)


# ---- 7.1 取值与类型转换 ----

_MISSING = object()   # 「这个字段根本没传」的哨兵，和「传了空字符串」区分开
_SKIP = object()      # 「这个值不合法，别写进去」的哨兵，保住数据库里的原值


def _pick(raw, field, rule):
    """
    从请求体里取值：先按字段名找，再按对外别名找。
    别名目前只有一处 —— quotes 的 from（API 名）对应 source（数据库列名），
    因为 from 是 Python 关键字，不能当列名。
    """
    if field in raw:
        return raw[field]
    for api_name, column_name in rule.get("aliases", {}).items():
        if column_name == field and api_name in raw:
            return raw[api_name]
    return _MISSING


def _coerce(kind, value):
    """
    把前端传来的值转成数据库列能接受的样子。
    前端传的都是字符串，直接往 Boolean / DateTime 列上写迟早出事，所以在这里统一收口。
    """
    if kind == "str":
        if value is None:
            return ""
        return value.strip() if isinstance(value, str) else str(value)

    if kind == "bool":
        # 勾选框可能传 true，"true" / "1" / "on" 也都认
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        return str(value).strip().lower() in ("1", "true", "yes", "on", "是", "已完成")

    if kind == "int":
        try:
            return int(float(str(value).strip() or 0))
        except (TypeError, ValueError):
            return 0

    if kind == "datetime":
        # 解析不出来就返回 _SKIP：宁可不改，也不要把 None 写进 NOT NULL 的列
        parsed = parse_local_dt(value)
        return parsed if parsed is not None else _SKIP

    return value


def _fill(obj, rule, raw, creating):
    """
    把请求里的字段填进模型对象，并返回「还缺哪些必填项」。

    creating=True  新增：只填请求里给的字段，其余留给 defaults / create_defaults
    creating=False 修改：只覆盖请求里出现的字段 —— 这就是「局部更新」，
                         前端勾选待办只发 {"done": true}，不会把 text 冲掉
    """
    # 1) 白名单字段：不在 fields 里的键（前端多传的）直接丢掉，这是防脏数据的第一道闸
    for field, kind in rule["fields"].items():
        picked = _pick(raw, field, rule)
        if picked is _MISSING:
            continue
        value = _coerce(kind, picked)
        if value is not _SKIP:
            setattr(obj, field, value)

    # 2) 空值兜底（空字符串也当「没填」）
    for field, default in rule.get("defaults", {}).items():
        if not getattr(obj, field, None):
            setattr(obj, field, default)

    # 3) 只在新增时盖章的字段（打卡时间、备忘录时间）
    if creating:
        for field, maker in rule.get("create_defaults", {}).items():
            if not getattr(obj, field, None):
                setattr(obj, field, maker() if callable(maker) else maker)

    # 4) 合并后校验：只有「改完之后的整体」不违反必填，才允许保存
    return [f for f in rule["required"] if not getattr(obj, f, None)]


def _find_owned(rule, item_id):
    """
    按 id 查一条，并确认它属于当前用户。
    不是自己的数据一律返回 None —— 对外表现成「不存在」，
    比回 403「这是别人的」更安全：不泄露「这个 id 存在」这个信息。
    """
    model = rule["model"]
    # query.get(id)：按主键查一条。SQLAlchemy 2.0 里 db.session.get(Model, id) 等价，
    # 这里用 query.get() 是因为它在 Flask-SQLAlchemy 教程里最常见，读起来更直白。
    obj = model.query.get(item_id)
    if obj is None:
        return None
    if not rule.get("shared") and obj.user_id != g.user.id:
        return None
    return obj


# ====================================================================
# 八、REST 接口：获取全部 / 按 id 查询 / 新增 / 修改 / 删除
# ====================================================================

@app.route("/api/data")
@login_required_api
def api_data():
    """全量数据接口。前端首屏用的是模板注入的那份，这个接口留给主动刷新/调试。"""
    return jsonify({"ok": True, "boot": build_boot()})


# ---- 8.1 获取全部 ----
@app.route("/api/<list_name>", methods=["GET"])
@login_required_api
def api_list(list_name):
    """
    获取全部记录（只返回当前登录用户的），按注册表里的规则排好序。
    例：GET /api/plans  → 每日计划，已按开始时间升序
    """
    rule = _rule_or_none(list_name)
    if rule is None:
        return _fail(f"未知的列表：{list_name}", 404)

    # query.all()：把符合条件的记录一次性捞出来
    items = [obj.to_dict() for obj in query_all(rule)]
    return jsonify({"ok": True, "list": list_name, "count": len(items), "items": items})


# ---- 8.2 按 id 查询 ----
@app.route("/api/<list_name>/<int:item_id>", methods=["GET"])
@login_required_api
def api_detail(list_name, item_id):
    """根据 id 查询单条。例：GET /api/todos/3"""
    rule = _rule_or_none(list_name)
    if rule is None:
        return _fail(f"未知的列表：{list_name}", 404)

    obj = _find_owned(rule, item_id)
    if obj is None:
        return _fail("这条记录已经不存在了，刷新一下页面", 404)
    return jsonify({"ok": True, "list": list_name, "item": obj.to_dict()})


# ---- 8.3 新增 ----
@app.route("/api/<list_name>", methods=["POST"])
@login_required_api
def api_create(list_name):
    """
    新增一条。请求体是 JSON 字典，例：{"task": "...", "time": "..."}
    标准三步：db.session.add(对象) → db.session.commit()
    """
    rule = _rule_or_none(list_name)
    if rule is None:
        return _fail(f"未知的列表：{list_name}", 404)

    raw = request.get_json(silent=True) or {}
    obj = rule["model"]()

    # 业务数据都要挂到人头上；quotes 是全局的，不挂
    if not rule.get("shared"):
        obj.user_id = g.user.id

    missing = _fill(obj, rule, raw, creating=True)
    if missing:
        return _fail("请先填写：" + "、".join(FIELD_LABEL.get(f, f) for f in missing))

    db.session.add(obj)      # 放进会话（还没有真正写库）
    db.session.commit()      # 提交事务 —— 到这一步数据才落盘，
                             # 也只有提交之后 obj.id 才有值
    return _ok(rule, obj)


# ---- 8.4 修改 ----
@app.route("/api/<list_name>/<int:item_id>", methods=["PUT"])
@login_required_api
def api_update(list_name, item_id):
    """
    修改一条（局部更新：只传想改的字段）。
    标准三步：先查询得到对象 → 改对象属性 → commit()

    待办勾选也走这里 —— {"done": true} 就是一次普通的局部更新。
    """
    rule = _rule_or_none(list_name)
    if rule is None:
        return _fail(f"未知的列表：{list_name}", 404)

    obj = _find_owned(rule, item_id)
    if obj is None:
        return _fail("这条记录已经不存在了，刷新一下页面", 404)

    raw = request.get_json(silent=True) or {}
    missing = _fill(obj, rule, raw, creating=False)
    if missing:
        return _fail("「" + FIELD_LABEL.get(missing[0], missing[0]) + "」不能为空")

    db.session.commit()      # 改的是「已经被 session 跟踪的对象」，直接 commit 就会写库
    return _ok(rule, obj)


# ---- 8.5 删除 ----
@app.route("/api/<list_name>/<int:item_id>", methods=["DELETE"])
@login_required_api
def api_delete(list_name, item_id):
    """
    删除一条。真删，不是软删。
    标准三步：查询对象 → db.session.delete(对象) → commit()
    """
    rule = _rule_or_none(list_name)
    if rule is None:
        return _fail(f"未知的列表：{list_name}", 404)

    obj = _find_owned(rule, item_id)
    if obj is None:
        return _fail("这条记录已经不存在了", 404)

    db.session.delete(obj)
    db.session.commit()
    return _ok()


# ====================================================================
# 九、注册 / 登录 / 退出接口
# ====================================================================

USERNAME_MIN, USERNAME_MAX = 2, 20
PASSWORD_MIN = 6


@app.route("/api/auth/register", methods=["POST"])
def api_register():
    """
    注册。请求体：{"username": "...", "password": "...", "password2": "..."}
    password2 可选（登录页有「确认密码」，直接调接口的可以不给）。

    注意：这里只建 users 表的一条记录，不给新用户灌任何模拟数据 ——
    需求里写得很清楚：新注册的用户首页应该是干净的，只有那句今日鼓励。
    """
    raw = request.get_json(silent=True) or {}
    username = (raw.get("username") or "").strip()
    password = raw.get("password") or ""
    password2 = raw.get("password2")

    if not (USERNAME_MIN <= len(username) <= USERNAME_MAX):
        return _fail(f"用户名长度请控制在 {USERNAME_MIN}–{USERNAME_MAX} 个字符")
    if len(password) < PASSWORD_MIN:
        return _fail(f"密码至少 {PASSWORD_MIN} 位，别偷懒")
    if password2 is not None and password2 != password:
        return _fail("两次输入的密码不一致")

    # 用户名查重。query.filter() 的典型用法：
    # 这里不能用 filter_by + first() 之外的写法吗？可以，但 filter() 更通用 ——
    # 以后要加「忽略大小写查重」时，filter(func.lower(...) == ...) 直接就能写。
    exists = User.query.filter(User.username == username).first()
    if exists is not None:
        return _fail("这个用户名已经被注册了，换一个吧")

    user = User(username=username)
    user.set_password(password)

    db.session.add(user)
    db.session.commit()

    # 注册完直接登录，省掉「注册→再输一遍密码」这一步
    session["user_id"] = user.id
    return jsonify({"ok": True, "user": user.to_dict(), "redirect": "/"})


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    """
    登录。请求体：{"username": "...", "password": "..."}
    用户名不存在和密码不对，返回同一句提示 ——
    分开说等于告诉攻击者「这个名字是存在的」，没必要送他这个信息。
    """
    raw = request.get_json(silent=True) or {}
    username = (raw.get("username") or "").strip()
    password = raw.get("password") or ""

    if not username or not password:
        return _fail("用户名和密码都要填")

    user = User.query.filter_by(username=username).first()
    if user is None or not user.check_password(password):
        return _fail("用户名或密码不对，再试一次", 401)

    # 登录成功：把用户 id 写进 session。
    # Flask 会把它签名后塞进 cookie，前端不用自己存 token。
    session["user_id"] = user.id
    session.permanent = False        # 关掉浏览器就失效，公共电脑上更安全
    return jsonify({"ok": True, "user": user.to_dict(), "redirect": "/"})


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    """退出（接口版）。侧栏走的是 /logout 页面版，两个都留着，按调用方方便来。"""
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
def api_me():
    """当前登录用户。未登录返回 401，前端可用它判断「要不要跳登录页」。"""
    if g.user is None:
        return jsonify({"ok": False, "user": None, "error": "未登录"}), 401
    return jsonify({"ok": True, "user": g.user.to_dict()})


# ====================================================================
# 十、错误处理
# ====================================================================

@app.errorhandler(404)
def handle_404(error):
    """
    接口路径写错时回 JSON（前端 res.json() 才解析得动），
    页面路径写错时保持默认的 HTML 提示。
    """
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "接口不存在，检查一下路径"}), 404
    return "页面不存在", 404


@app.errorhandler(500)
def handle_500(error):
    """
    兜底：任何没接住的异常都不要把 Python 堆栈丢给浏览器 ——
    调试模式下 Flask 自己会显示，生产模式下必须收住。
    """
    db.session.rollback()        # 出错就把没提交的改动回滚掉，别留半截数据
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "服务端出了点问题，稍后再试"}), 500
    return "服务端出了点问题", 500


@app.teardown_request
def cleanup_session(exception=None):
    """
    每个请求结束时收尾：出错就回滚。
    没有这一步，一个请求里的半截改动会污染同一个线程后续的请求。
    """
    if exception is not None:
        db.session.rollback()


# ====================================================================
# 十一、初始化数据库：建表 + 一份示例数据
# ====================================================================

# 演示账号。第一次运行会用它灌样例数据，登录页上也会提示这个账号。
# 部署到公网以后建议改掉密码（或用环境变量覆盖），别让陌生人进来改数据。
DEMO_USERNAME = os.environ.get("DEMO_USERNAME", "思洋")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "123456")


def _seed_quotes():
    """
    首页励志语录。全局共享，所以只灌一次、不挂 user_id。
    这三句是按思洋的真实处境写的：考研英语二打基础、民办本科自学、每日打卡。
    """
    return [
        Quote(text="你不需要很厉害才能开始，你需要开始才会很厉害。",
              source=f"写给正在起步的{DEMO_USERNAME}", sort_no=1),
        Quote(text="今天多背的四十个单词，都是明年多出来的一条路。",
              source="考研英语二 · 打基础阶段", sort_no=2),
        Quote(text="把小事做完，永远比把大事想完更有用。",
              source="每日打卡 · 给四年后的自己", sort_no=3),
    ]


def _seed_records(user_id):
    """
    示例业务数据，按思洋的真实节奏写：
    微积分 / 大英、网管会技术部、校工会数据统计部、日语、
    考研（数二 + 英语二）、作品集项目、CSDN/知乎 两处更新。
    只是「开箱能看懂」的样例，不是他的真实台账 —— 真数据在页面上直接增删改。

    这些数据全部挂在演示账号（DEMO_USERNAME）名下，
    别的用户登录进来看到的是自己的空列表。
    """
    now = _now()
    at = lambda days, hour, minute: (now - timedelta(days=days)).replace(  # noqa: E731
        hour=hour, minute=minute, second=0, microsecond=0)

    plans = [
        Plan(user_id=user_id, time="07:00 – 07:40", task="起床 + 食堂早餐，顺一遍今天的课表", tag="生活"),
        Plan(user_id=user_id, time="08:00 – 09:40", task="微积分（上）· 计科 8 班 · 第二章 极限", tag="上课"),
        Plan(user_id=user_id, time="10:00 – 11:40", task="大学英语Ⅰ · 精读一篇 + 听力 15 分钟", tag="上课"),
        Plan(user_id=user_id, time="14:30 – 17:00", task="网管会技术部值班：打网线、跟进报障工单", tag="组织"),
        Plan(user_id=user_id, time="19:00 – 20:30", task="考研数学（数二）基础一节 + 英语二单词 40 个", tag="考研"),
        Plan(user_id=user_id, time="20:40 – 21:40", task="日语五十音 た行默写 / 写一篇技术笔记", tag="日语"),
    ]
    todos = [
        Todo(user_id=user_id, text="交微积分（上）第二章作业", done=True),
        Todo(user_id=user_id, text="背完考研英语二 Unit 3 的 40 个词", done=True),
        Todo(user_id=user_id, text="整理网管会值班记录，交本周报障统计", done=False),
        Todo(user_id=user_id, text="给作品集第 20 个项目补 README 和封面图", done=False),
        Todo(user_id=user_id, text="把《入党申请书》交给团支书", done=False),
        Todo(user_id=user_id, text="日语：五十音 あ行—た行 默写一遍", done=False),
    ]
    # 考研英语二的高频词，不是随便凑的
    words = [
        Word(user_id=user_id, word="accumulate", phonetic="/əˈkjuːmjəleɪt/", meaning="v. 积累；积聚"),
        Word(user_id=user_id, word="discipline", phonetic="/ˈdɪsəplɪn/", meaning="n. 自律；纪律"),
        Word(user_id=user_id, word="threshold", phonetic="/ˈθreʃhəʊld/", meaning="n. 门槛；临界点"),
        Word(user_id=user_id, word="efficiency", phonetic="/ɪˈfɪʃnsi/", meaning="n. 效率；功效"),
        Word(user_id=user_id, word="revise", phonetic="/rɪˈvaɪz/", meaning="v. 修改；复习"),
        Word(user_id=user_id, word="persist", phonetic="/pəˈsɪst/", meaning="v. 坚持；持续存在"),
    ]
    workouts = [
        Workout(user_id=user_id, name="热身拉伸", duration="10 分钟", sets="1 组", note="久坐敲代码，先把肩颈和髋打开"),
        Workout(user_id=user_id, name="俯卧撑", duration="12 分钟", sets="4 组 × 15 次", note="手肘别外张，胸口找地面"),
        Workout(user_id=user_id, name="平板支撑", duration="6 分钟", sets="3 组 × 45 秒", note="腰别塌，收紧核心"),
        Workout(user_id=user_id, name="操场慢跑", duration="25 分钟", sets="3 公里", note="配速轻松，能正常说话"),
    ]
    meals = [
        Meal(user_id=user_id, meal="早餐", menu="食堂二楼：豆浆 + 水煮蛋 + 菜包", kcal="380", tag="顶住早八"),
        Meal(user_id=user_id, meal="午餐", menu="一荤两素 + 半碗米饭（少油窗口）", kcal="620", tag="别吃太饱"),
        Meal(user_id=user_id, meal="加餐", menu="无糖酸奶 + 一个苹果", kcal="150", tag="犯困前吃"),
        Meal(user_id=user_id, meal="晚餐", menu="番茄鸡蛋面 + 一份青菜", kcal="520", tag="自习前吃完"),
    ]
    checkins = [
        Checkin(user_id=user_id, text="微积分第二章终于啃完了，题做得慢，但一步没跳。", at=at(0, 21, 40)),
        Checkin(user_id=user_id, text="第一次独立打好一根网线，测通那一下挺爽。", at=at(1, 20, 15)),
        Checkin(user_id=user_id, text="考研英语二阅读错了一半，先不慌，慢慢磨。", at=at(2, 22, 2)),
    ]
    media = [
        Media(user_id=user_id, title="Python 爬虫：从登录态到手写 Cookie 的完整链路", platform="CSDN", status="已发布", views=3260),
        Media(user_id=user_id, title="JS 加密逆向里我踩过的 5 个坑", platform="知乎", status="已发布", views=8600),
        Media(user_id=user_id, title="一个能跑的语音助手长什么样：18 个项目 + 102 条单测", platform="CSDN", status="撰写中", views=0),
        Media(user_id=user_id, title="民办本科自学 AI 的半年：我的真实路径", platform="知乎", status="构思中", views=0),
    ]
    memos = [
        Memo(user_id=user_id, time=datetime(2026, 9, 21, 16, 0), text="把《入党申请书》交给团支书"),
        Memo(user_id=user_id, time=datetime(2026, 9, 22, 9, 30), text="日语课：五十音 あ行—た行 随堂测"),
        Memo(user_id=user_id, time=datetime(2026, 9, 23, 19, 0), text="作品集第 20 个项目补 README + 封面图"),
        Memo(user_id=user_id, time=datetime(2026, 9, 25, 20, 0), text="查成都信息工程大学 2027 招生简章：专硕专业课自命题科目"),
    ]
    return plans + todos + words + workouts + meals + checkins + media + memos


def init_database():
    """
    初始化数据库：建表 + 灌示例数据。

    为什么要 with app.app_context()？
    因为 db.create_all() 和 Model.query 都要知道「连的是哪个数据库」，
    而这个信息存在「应用上下文」里。脚本里直接裸调会报
    RuntimeError: Working outside of application context —— 这是 Flask 新手最常见的坑之一。
    """
    db.create_all()          # 建表。已存在的表不会被覆盖（幂等），可以放心每次启动都跑

    # 已经有用户了，说明不是第一次运行，绝不能再灌一遍样例
    if User.query.first() is not None:
        return

    demo = User(username=DEMO_USERNAME)
    demo.set_password(DEMO_PASSWORD)
    db.session.add(demo)
    db.session.flush()       # flush（不是 commit）：先把 INSERT 发出去，好拿到自增出来的 id

    db.session.add_all(_seed_quotes())              # 全局语录
    db.session.add_all(_seed_records(demo.id))      # 挂在演示账号下的样例数据
    db.session.commit()

    print(f"[init] 已创建数据表，并灌入示例数据（演示账号：{DEMO_USERNAME} / {DEMO_PASSWORD}）")


# 模块加载时就初始化一次。
# 放这里而不是 __main__ 里，是为了让 gunicorn / flask run 这类不以 __main__ 启动的方式
# 也能自动建表 —— 部署时少一步手工操作，就少一个「忘了建表」的故障点。
with app.app_context():
    init_database()


# ====================================================================
# 十二、启动
# ====================================================================

if __name__ == "__main__":
    # 开发默认 127.0.0.1:5000；部署到服务器时用环境变量改：
    #   HOST=0.0.0.0 PORT=5000 FLASK_DEBUG=0 python3 app.py
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"

    print("=" * 60)
    print("  思洋 · 个人管理台 已启动（SQLite 版）")
    print(f"  数据库文件： {DB_PATH}")
    print(f"  浏览器打开： http://{'127.0.0.1' if host == '0.0.0.0' else host}:{port}")
    print(f"  演示账号：   {DEMO_USERNAME} / {DEMO_PASSWORD}")
    print("  停止服务：   在这个窗口按 Ctrl+C")
    print("=" * 60)

    # 注意：debug=True 会自动重启、并在出错时把源码显示在页面上。
    # 本地开发很方便，公网上必须关掉（FLASK_DEBUG=0），
    # 而且正式部署应该用 gunicorn 这类 WSGI 服务器，不要直接跑 app.run()。
    app.run(host=host, port=port, debug=debug)
