// 三角洲子弹行情 - Electron 主程序
// 职责：开一个软件窗口，加载 web/index.html
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: '三角洲子弹行情',
    autoHideMenuBar: true,          // 隐藏菜单栏，更像软件
    backgroundColor: '#14161c',     // 窗口底色和网页一致，打开不闪白
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,       // 网页不需要 Node 权限，更安全
    },
  });

  win.loadFile(path.join(__dirname, 'web', 'index.html'));

  // 网页里如果有外链，用系统浏览器打开而不是在软件内跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();   // 关窗口 = 退出软件（符合软件习惯）
});
