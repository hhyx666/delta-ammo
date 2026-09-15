# -*- coding: utf-8 -*-
"""
三角洲子弹行情采集器
====================
功能：每 10 分钟从 6ow.cc 抓一次子弹实时价格，存进 data.json
用法：
  - 双击"启动采集.bat"       （一直跑，每10分钟抓一次）
  - python collector.py once （只抓一次，用于测试）
依赖：只用 Python 自带的标准库，不需要安装任何东西
"""
import json
import sys
import time
import hashlib
import urllib.request
import urllib.parse
import os

# ================= 配置区 =================
API_URL = "https://6ow.cc/api/api.php?act=zxb"   # 数据接口地址
INTERVAL = 600          # 抓取间隔（秒）。10分钟一次，别调太快，否则可能被网站封
# 数据文件存到 web 文件夹里，这样网页能直接读到
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "data.json")
MAX_DAYS = 30           # 最多保留 30 天历史，文件不会无限变大
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")


def make_sign(ts):
    """计算防爬签名：v = MD5("act=ammo&type=" + 时间戳毫秒 + "ammo")"""
    text = "act=ammo&type=" + str(ts) + "ammo"
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def fetch_prices():
    """抓一次价格，返回 {子弹ID: {"name":名称, "grade":等级, "price":单价}}"""
    ts = int(time.time() * 1000)
    body = urllib.parse.urlencode({"timestamp": ts, "v": make_sign(ts)}).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://6ow.cc/pages/ammo.php",
        "Accept": "application/json, text/javascript, */*; q=0.01",
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8")
    data = json.loads(raw)   # 接口返回 [{"name":包名, "bullets":[{...}]}, ...]
    result = {}
    for pack in data:
        for b in pack.get("bullets", []):
            result[b["objectID"]] = {
                "name": b["objectName"],
                "grade": b.get("grade", ""),
                "price": b["price"],
            }
    return result


def load_data():
    """读取本地数据文件；不存在就返回空结构"""
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"updated": 0, "bullets": {}}


def save_data(d):
    """先写临时文件再改名，避免写到一半断电导致数据损坏"""
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


def collect_once():
    """抓一次并保存，返回这次抓到的子弹数量"""
    prices = fetch_prices()
    data = load_data()
    now = int(time.time() * 1000)
    data["updated"] = now
    cutoff = now - MAX_DAYS * 24 * 3600 * 1000   # 超过30天的记录丢弃
    for bid, info in prices.items():
        entry = data["bullets"].setdefault(
            str(bid), {"name": info["name"], "grade": info["grade"], "history": []})
        entry["name"] = info["name"]
        entry["grade"] = info["grade"]
        entry["history"].append([now, info["price"]])
        entry["history"] = [h for h in entry["history"] if h[0] >= cutoff]
    save_data(data)
    return prices


def main():
    print("三角洲子弹行情采集器已启动")
    print("每 %d 分钟抓一次，窗口开着就行，按 Ctrl+C 可停止\n" % (INTERVAL // 60))
    while True:
        try:
            prices = collect_once()
            sample = "、".join("%s %d" % (v["name"], v["price"])
                               for v in list(prices.values())[:4])
            print("%s 抓取成功：%d 种子弹 | %s ..."
                  % (time.strftime("%H:%M:%S"), len(prices), sample))
        except Exception as e:
            print("%s 抓取失败：%s（等下一轮自动重试）" % (time.strftime("%H:%M:%S"), e))
        time.sleep(INTERVAL)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "once":
        prices = collect_once()
        print("抓取成功：%d 种子弹，已保存到 %s" % (len(prices), DATA_FILE))
        for bid, v in list(prices.items())[:6]:
            print("  %-16s 单价 %d" % (v["name"], v["price"]))
    else:
        main()
