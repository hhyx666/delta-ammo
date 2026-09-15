// -*- coding: utf-8 -*-
/*
三角洲子弹行情采集器（全量版）
================================
原理：用电脑里的 Edge 浏览器（无头模式，不弹窗口）打开 6ow.cc 交易行页，
      网站自己会加载全部 1357 件物品的数据（其中子弹 85 种），
      我们直接从浏览器缓存里把子弹数据取出来存进 data.json。

用法：
  - 双击"启动采集.bat"        （一直跑，每10分钟抓一次）
  - node collector.js once    （只抓一次，用于测试）

依赖：Node.js（你电脑已装） + Edge 浏览器（系统自带），不需要安装任何东西
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 浏览器选择：Windows 用 Edge；Linux（GitHub 服务器）用 Chrome
const IS_WIN = process.platform === 'win32';
const BROWSER = IS_WIN
  ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  : 'google-chrome';
const BROWSER_EXTRA = IS_WIN ? [] : ['--no-sandbox', '--disable-dev-shm-usage'];
const PORT = 9233;
const INTERVAL = 600 * 1000;                       // 抓取间隔 10 分钟
const DATA_FILE = path.join(__dirname, 'web', 'data.json');
const PROFILE = path.join(os.tmpdir(), 'df-edge-profile');
const SIZE_WARN_MB = 50;                           // 数据超过这个大小就在桌面放提醒文件
const SIZE_WARN_MARKER = path.join(os.homedir(), 'Desktop', '三角洲行情-数据较大.txt');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitEdgeReady(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); return true; }
    catch (e) { await sleep(500); }
  }
  return false;
}

async function collectOnce() {
  // 每次用全新的浏览器配置，保证网站一定重新拉最新数据
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* 删不掉就算了 */ }
  const edge = spawn(BROWSER, [
    ...BROWSER_EXTRA,
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1400,900', 'about:blank'
  ], { stdio: 'ignore' });

  try {
    if (!(await waitEdgeReady(PORT, 30000))) throw new Error('Edge 启动失败');
    const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let idc = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++idc;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg.result); pending.delete(msg.id); }
    };
    await new Promise(r => { ws.onopen = r; });
    await send('Page.enable');
    await send('Runtime.enable');

    // 第一步：先开子弹页（网站需要这个前置状态）
    await send('Page.navigate', { url: 'https://6ow.cc/pages/ammo.php' });
    await sleep(12000);

    // 第二步：开交易行页，等它把全量数据加载进缓存
    const start = Date.now();
    await send('Page.navigate', { url: 'https://6ow.cc/pages/market.php' });
    let dataStr = null, lastFetch = 0;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const r = await send('Runtime.evaluate', {
        expression: 'JSON.stringify({d: localStorage.getItem("apiData"), t: localStorage.getItem("lastFetchTime")})',
        returnByValue: true,
      });
      const info = JSON.parse(r.result.value);
      if (info.d && Number(info.t) > start) { dataStr = info.d; lastFetch = Number(info.t); break; }
    }
    if (!dataStr) throw new Error('等不到网站加载数据（超时）');

    // 从全量物品里筛出所有子弹
    const all = JSON.parse(dataStr);
    const ammo = all.filter(it => it.primaryClass === 'ammo');
    if (!ammo.length) throw new Error('数据里没有子弹条目');

    // 读旧数据 → 追加新记录 → 保存（历史永久保留，不删除）
    const now = Date.now();
    const data = fs.existsSync(DATA_FILE)
      ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
      : { updated: 0, bullets: {} };
    data.updated = now;
    for (const it of ammo) {
      const id = String(it.objectID);
      const entry = data.bullets[id] || (data.bullets[id] = { name: it.objectName, grade: it.grade, history: [] });
      entry.name = it.objectName;
      entry.grade = it.grade;
      // 防重复：如果上一笔记录就在一分钟内（比如自动任务和手动双击同时开着），跳过不重复记
      const last = entry.history[entry.history.length - 1];
      if (!last || now - last[0] > 60000) {
        entry.history.push([now, Number(it.price)]);
      }
      entry.day_h = Number(it.day_h);   // 今日最高价
      entry.day_m = Number(it.day_m);   // 今日最低价
      entry.day = Number(it.day);       // 今日涨跌幅(%)
      entry.lastTime = it.time;         // 网站数据的最后更新时间

      // 自动补点：网站知道今日最高/最低发生在几点几分，
      // 用这两个真实点位补上没采集到的时段（比如夜里关机那段时间）
      const tsOf = s => {
        const t = new Date(String(s).replace(' ', 'T'));
        return isNaN(t.getTime()) ? 0 : t.getTime();
      };
      for (const [t0, p0] of [[tsOf(it.h_time), Number(it.day_h)], [tsOf(it.m_time), Number(it.day_m)]]) {
        if (!t0 || !p0 || isNaN(p0)) continue;
        if (!entry.history.some(h => Math.abs(h[0] - t0) < 60000)) {
          entry.history.push([t0, p0]);
        }
      }
      entry.history.sort((a, b) => a[0] - b[0]);
    }
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, DATA_FILE);

    // 数据太大时在桌面放一个提醒文件（只放一次，不重复打扰）
    const sizeMB = fs.statSync(DATA_FILE).size / 1048576;
    if (sizeMB > SIZE_WARN_MB && !fs.existsSync(SIZE_WARN_MARKER)) {
      fs.writeFileSync(SIZE_WARN_MARKER,
        '提醒：三角洲行情数据文件已超过 ' + SIZE_WARN_MB + ' MB（当前约 ' + sizeMB.toFixed(1) + ' MB）。\n' +
        '所有历史数据都完好保存在 D 盘，可继续使用；如果担心占用空间，可找 Claude 帮你归档整理。\n');
    }

    ws.close();
    return { count: ammo.length, kb: Math.round(fs.statSync(DATA_FILE).size / 1024) };
  } finally {
    try { edge.kill(); } catch (e) { }
    await sleep(1500);   // 等浏览器完全退出再删配置
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(PROFILE, { recursive: true, force: true }); break; }
      catch (e) { await sleep(1000); }
    }
  }
}

async function main() {
  console.log('三角洲子弹行情采集器（全量版）已启动');
  console.log('每 10 分钟抓一次全部子弹价格，窗口开着别关，按 Ctrl+C 停止\n');
  while (true) {
    const t0 = Date.now();
    try {
      const r = await collectOnce();
      console.log(`${new Date().toLocaleTimeString('zh-CN')} 抓取成功：${r.count} 种子弹，用时 ${Math.round((Date.now() - t0) / 1000)} 秒，数据文件 ${r.kb} KB`);
    } catch (e) {
      console.log(`${new Date().toLocaleTimeString('zh-CN')} 抓取失败：${e.message}（等下一轮自动重试）`);
    }
    await sleep(INTERVAL);
  }
}

if (process.argv[2] === 'once') {
  collectOnce().then(r => console.log(`抓取成功：${r.count} 种子弹，已保存到 ${DATA_FILE}（${r.kb} KB）`))
    .catch(e => { console.error('失败：' + e.message); process.exit(1); });
} else {
  main();
}
