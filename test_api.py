# -*- coding: utf-8 -*-
"""jiajia 项目接口自测：登录态、五套 CRUD、排序、多用户隔离。

用法：
    python test_api.py                                          # 默认打本机 5111
    BASE_URL=http://127.0.0.1:5000 python test_api.py           # 换成别的端口
    BASE_URL=http://8.137.90.25:5000 python test_api.py         # 直接打线上
    BASE_URL=http://8.137.90.25:5000 python3 test_api.py        # 服务器上跑（venv 里的 python）

注意：脚本会真的往数据库里写数据（新建 u测试用户 账号 + 改动演示账号的待办），
所以别在生产库上随手反复跑；跑完想恢复干净数据，删掉 simon.db 重启服务即可。
"""
import datetime
import json
import os
import urllib.request
import urllib.error
from http.cookiejar import CookieJar

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:5111")

pass_count = 0
fail_count = 0


def check(name, cond, extra=""):
    global pass_count, fail_count
    if cond:
        pass_count += 1
        print(f"  [PASS] {name}")
    else:
        fail_count += 1
        print(f"  [FAIL] {name}  {extra}")


def new_session():
    """每个用户一个独立 cookie 罐，模拟不同浏览器。"""
    jar = CookieJar()
    # 显式禁用系统代理：本机环境设了 HTTP_PROXY，
    # 不绕过的话 127.0.0.1 的请求会被发到代理上去（502）。
    no_proxy = urllib.request.ProxyHandler({})
    return urllib.request.build_opener(no_proxy, urllib.request.HTTPCookieProcessor(jar))


def call(opener, method, path, body=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req, data=data) as resp:
            text = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8")
        status = e.code
    if raw:
        return status, text
    try:
        return status, json.loads(text)
    except json.JSONDecodeError:
        return status, text


print("=" * 64)
print("一、未登录时的拦截")
print("=" * 64)
anon = new_session()
status, text = call(anon, "GET", "/", raw=True)
check("GET / 未登录重定向到 /login", status == 200 and "登录" in text, f"status={status}")
check("GET / 返回的是登录页而非仪表盘", "个人管理台" in text and "auth__card" in text)
status, js = call(anon, "GET", "/api/plans")
check("GET /api/plans 未登录返回 401", status == 401, f"status={status} body={js}")
status, js = call(anon, "GET", "/api/data")
check("GET /api/data 未登录返回 401", status == 401, f"status={status}")
status, text = call(anon, "GET", "/login", raw=True)
check("GET /login 正常打开", status == 200 and "form-register" in text)

print()
print("=" * 64)
print("二、登录（演示账号）")
print("=" * 64)
siyang = new_session()
status, js = call(siyang, "POST", "/api/auth/login", {"username": "思洋", "password": "wrong"})
check("密码错误返回 401", status == 401 and js.get("ok") is False, f"{status} {js}")
status, js = call(siyang, "POST", "/api/auth/login", {"username": "思洋", "password": "123456"})
check("正确密码登录成功", status == 200 and js.get("ok") is True, f"{status} {js}")
check("登录返回用户信息", (js.get("user") or {}).get("username") == "思洋")
check("登录不带密码字段", "password_hash" not in json.dumps(js))

status, js = call(siyang, "GET", "/api/data")
boot = js["boot"]
check("GET /api/data 已登录 200", status == 200 and js["ok"])
check("boot.owner 是登录用户名", boot["owner"] == "思洋", boot.get("owner"))
check("问候语含登录用户名", "思洋" in boot["greeting"], boot.get("greeting"))
check("语录仍保留（今日份鼓励）", len(boot["quotes"]) == 3, boot.get("quotes"))
check("语录字段名仍是 from", "from" in boot["quotes"][0])
check("8 个列表齐全", set(boot["lists"]) == {"plans", "todos", "words", "workouts", "meals", "checkins", "media", "memos"},
      set(boot["lists"]))
check("统计卡数据来自数据库", boot["stats"]["todo"] == 6 and boot["stats"]["done"] == 2, boot["stats"])
check("打卡显示为「今天/昨天」人话格式", any("今天" in c["at"] or "昨天" in c["at"] for c in boot["lists"]["checkins"]),
      boot["lists"]["checkins"][0])

print()
print("=" * 64)
print("三、每日计划：按时间升序（需求第 9 条）")
print("=" * 64)
status, js = call(siyang, "GET", "/api/plans")
check("GET /api/plans 返回全部", status == 200 and js["count"] == 6, f"{status} {js.get('count')}")
before = [p["time"] for p in js["items"]]
print("    排序结果：", " | ".join(before))
starts = [int(t.split(":")[0]) * 60 + int(t.split(":")[1].split()[0]) for t in before]
check("初始就是升序", starts == sorted(starts), starts)

# 新增一条最早的计划，看它是否自动排到第一位
status, js = call(siyang, "POST", "/api/plans", {"time": "06:30 – 07:00", "task": "早起背单词", "tag": "考研"})
new_id = js["item"]["id"]
check("POST /api/plans 新增成功", status == 200 and js["ok"], f"{status} {js}")
check("新增后 boot 里的计划条数 +1", len(js["boot"]["lists"]["plans"]) == 7)
check("POST 返回值里已排好序（第 1 条是刚加的 06:30）",
      js["boot"]["lists"]["plans"][0]["time"].startswith("06:30"), js["boot"]["lists"]["plans"][0])
check("tag 空值兜底为「未分类」可用", js["item"]["tag"] == "考研")

# 缺必填
status, js = call(siyang, "POST", "/api/plans", {"time": "09:00 – 10:00"})
check("POST 缺必填返回 400 + 人话提示", status == 400 and "要做的事" in js["error"], f"{status} {js}")

# 修改：把刚加的时间改成最晚，看它是否挪到末尾
status, js = call(siyang, "PUT", f"/api/plans/{new_id}", {"time": "23:00 – 23:30"})
check("PUT /api/plans/<id> 修改成功", status == 200 and js["ok"], f"{status} {js}")
after = js["boot"]["lists"]["plans"]
check("改时间后自动重排到末尾", str(after[-1]["id"]) == str(new_id), [p["time"] for p in after])
print("    重排结果：", " | ".join(p["time"] for p in after))

status, js = call(siyang, "POST", "/api/plans", {"time": "12:00 – 12:30", "task": "午饭", "tag": "生活"})
mid_id = js["item"]["id"]
times = [p["time"] for p in js["boot"]["lists"]["plans"]]
check("插在中间的时间也排到正确位置（12:00 在 10:00 之后、14:30 之前）",
      times.index("12:00 – 12:30") == 3, times)

status, js = call(siyang, "PUT", f"/api/plans/{mid_id}", {"task": "只改任务名不动时间"})
check("局部更新：只传 task 也能保存", status == 200 and js["ok"], f"{status} {js}")
check("局部更新不影响 time", any(str(p["id"]) == str(mid_id) and p["time"] == "12:00 – 12:30" for p in js["boot"]["lists"]["plans"]))

print()
print("=" * 64)
print("四、按 id 查询 / 删除")
print("=" * 64)
status, js = call(siyang, "GET", "/api/todos/1")
check("GET /api/todos/1 单条查询", status == 200 and str(js["item"]["id"]) == "1", f"{status} {js}")
status, js = call(siyang, "GET", "/api/todos/99999")
check("查不存在的 id 返回 404", status == 404 and js["ok"] is False, f"{status} {js}")
status, js = call(siyang, "GET", "/api/nothing")
check("未知表名返回 404", status == 404, f"{status} {js}")
status, js = call(siyang, "GET", "/api/plans/abc")
check("id 非数字返回 404 JSON", status == 404 and js.get("ok") is False, f"{status} {js}")

status, js = call(siyang, "DELETE", f"/api/plans/{new_id}")
check("DELETE /api/plans/<id> 删除成功", status == 200 and js["ok"], f"{status} {js}")
check("删除后条数回到 7", len(js["boot"]["lists"]["plans"]) == 7)
status, js = call(siyang, "DELETE", f"/api/plans/{new_id}")
check("重复删除返回 404", status == 404, f"{status} {js}")

print()
print("=" * 64)
print("五、待办勾选（局部更新）")
print("=" * 64)
status, js = call(siyang, "PUT", "/api/todos/3", {"done": True})
check("PUT /api/todos/3 {done:true} 成功", status == 200 and js["ok"], f"{status} {js}")
check("已完成计数变成 3", js["boot"]["stats"]["done"] == 3, js["boot"]["stats"])
check("只传 done 不会丢掉 text", any(str(t["id"]) == "3" and t["text"] for t in js["boot"]["lists"]["todos"]))
status, js = call(siyang, "PUT", "/api/todos/3", {"text": ""})
check("把必填改成空返回 400", status == 400 and "内容" in js["error"], f"{status} {js}")

print()
print("=" * 64)
print("六、注册新用户：无模拟数据 + 数据隔离")
print("=" * 64)
# 用户名带时间戳：脚本可以反复跑，不会第二次就撞「重名」而失败
NEW_USER = "测试同学" + datetime.datetime.now().strftime("%H%M%S")
fresh = new_session()
status, js = call(fresh, "POST", "/api/auth/register", {"username": "a", "password": "123456"})
check("用户名太短被拒", status == 400 and "2–20" in js["error"], f"{status} {js}")
status, js = call(fresh, "POST", "/api/auth/register", {"username": NEW_USER, "password": "123"})
check("密码太短被拒", status == 400, f"{status} {js}")
status, js = call(fresh, "POST", "/api/auth/register", {"username": NEW_USER, "password": "abc123", "password2": "abc999"})
check("两次密码不一致被拒", status == 400, f"{status} {js}")
status, js = call(fresh, "POST", "/api/auth/register", {"username": "思洋", "password": "abc123"})
check("重名被拒（query.filter 查重）", status == 400 and "已经被注册" in js["error"], f"{status} {js}")
status, js = call(fresh, "POST", "/api/auth/register", {"username": NEW_USER, "password": "abc123", "password2": "abc123"})
check("注册成功并自动登录", status == 200 and js["ok"], f"{status} {js}")

status, js = call(fresh, "GET", "/api/data")
f_boot = js["boot"]
check("新用户 owner 是新用户名", f_boot["owner"] == NEW_USER, f_boot["owner"])
check("新用户 8 个列表全部为空（无模拟数据）",
      all(len(v) == 0 for v in f_boot["lists"].values()),
      {k: len(v) for k, v in f_boot["lists"].items()})
check("新用户首页仍有今日份鼓励语句", len(f_boot["quotes"]) == 3, len(f_boot["quotes"]))
check("新用户统计全为 0", all(v == 0 for v in f_boot["stats"].values()), f_boot["stats"])

# 数据隔离
status, js = call(fresh, "GET", "/api/todos/1")
check("新用户读不到别人的记录（404）", status == 404, f"{status} {js}")
status, js = call(fresh, "PUT", "/api/todos/1", {"text": "偷改别人的"})
check("新用户改不了别人的记录（404）", status == 404, f"{status} {js}")
status, js = call(fresh, "DELETE", "/api/todos/1")
check("新用户删不了别人的记录（404）", status == 404, f"{status} {js}")
status, js = call(fresh, "GET", "/api/todos")
check("新用户 GET /api/todos 为空", js["count"] == 0, js)

# 新用户自己建数据
status, js = call(fresh, "POST", "/api/checkins", {"text": "我的第一条打卡"})
check("新用户可以打卡", status == 200 and len(js["boot"]["lists"]["checkins"]) == 1, f"{status} {js}")
check("打招呼名字跟着登录用户走", js["boot"]["owner"] == NEW_USER)

# 回到思洋，确认数据没被串
status, js = call(siyang, "GET", "/api/todos")
check("老用户数据没被新用户影响", js["count"] == 6, js["count"])

print()
print("=" * 64)
print("七、其余列表接口连通性")
print("=" * 64)
for path, expect in [("words", 6), ("workouts", 4), ("meals", 4), ("checkins", 3), ("media", 4), ("memos", 4)]:
    status, js = call(siyang, "GET", f"/api/{path}")
    check(f"GET /api/{path} -> {expect} 条", status == 200 and js["count"] == expect, f"{status} {js.get('count')}")

status, js = call(siyang, "GET", "/api/memos")
memo_times = [m["time"] for m in js["items"]]
check("备忘录按时间升序", memo_times == sorted(memo_times), memo_times)

status, js = call(siyang, "POST", "/api/memos", {"text": "不带时间也要能存"})
check("备忘录不传时间时服务端盖章", status == 200 and js["item"]["time"], f"{status} {js}")

status, js = call(siyang, "POST", "/api/media", {"title": "测试选题"})
check("自媒体默认值兜底（platform/status）",
      js["item"]["platform"] == "CSDN" and js["item"]["status"] == "构思中", js["item"])
status, js = call(siyang, "POST", "/api/media", {"title": "带浏览量的", "views": "12345"})
check("字符串浏览量转成整数", js["item"]["views"] == 12345, js["item"])

status, js = call(siyang, "GET", "/api/quotes")
check("语录表可读（全局共享）", status == 200 and js["count"] == 3, f"{status} {js}")
status, js = call(siyang, "POST", "/api/quotes", {"text": "新加的一句", "from": "别名 from -> source"})
check("quotes 的 from 别名写入成功", status == 200 and js["item"]["from"] == "别名 from -> source", js["item"])

print()
print("=" * 64)
print("八、退出登录")
print("=" * 64)
status, text = call(fresh, "GET", "/logout", raw=True)
check("GET /logout 清掉登录态", "auth__card" in text, status)
status, js = call(fresh, "GET", "/api/data")
check("退出后接口变回 401", status == 401, f"{status} {js}")

print()
print("=" * 64)
print(f"结果：通过 {pass_count} 项，失败 {fail_count} 项")
print("=" * 64)
