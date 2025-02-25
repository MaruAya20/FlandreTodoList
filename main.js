const { app, BrowserWindow,ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

let db;

// 创建数据库并打开
function initDb() {
  db = new sqlite3.Database('./todos.db', (err) => {
    if (err) { 
      console.error('Failed to connect to database:', err.message); // 修改这里，打印详细的错误信息
      return; // 如果数据库连接失败，就停止执行
    }
    console.log('Connected to SQLite database');
    // 创建 todos 表
    db.run(`CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      completed BOOLEAN DEFAULT 0
    )`);
  });
}

// 获取所有待办事项
ipcMain.handle('get-todos', (event) => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM todos', [], (err, rows) => {
      if (err) {
        reject(err); // 如果查询失败，返回错误
      } else {
        resolve(rows); // 如果查询成功，返回数据
      }
    });
  });
});

// 添加新的待办事项
ipcMain.handle('add-todo', (event, content) => {
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO todos (content) VALUES (?)', [content], function(err) {
      if (err) {
        reject(err); // 如果插入失败，返回错误
      } else {
        resolve({ id: this.lastID, content, completed: 0 }); // 如果插入成功，返回新插入的任务
      }
    });
  });
});

// 切换任务完成状态
ipcMain.handle('toggle-todo', (event, id) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT completed FROM todos WHERE id = ?', [id], (err, row) => {
      if (err) {
        reject(err); // 如果查询失败，返回错误
      } else {
        const newStatus = row.completed === 0 ? 1 : 0;
        db.run('UPDATE todos SET completed = ? WHERE id = ?', [newStatus, id], (err) => {
          if (err) {
            reject(err); // 如果更新失败，返回错误
          } else {
            resolve({ id, completed: newStatus }); // 返回更新后的状态
          }
        });
      }
    });
  });
});

// 删除任务
ipcMain.handle('delete-todo', (event, id) => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM todos WHERE id = ?', [id], (err) => {
      if (err) {
        reject(err); // 如果删除失败，返回错误
      } else {
        resolve(id); // 如果删除成功，返回任务 ID
      }
    });
  });
});

// 创建主窗口
function createWindow() {
  const win = new BrowserWindow({
    width: 790,
    height: 980,
    icon: path.join(__dirname, 'icon/icon_dairi02.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // 加载 preload.js
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  initDb();  // 初始化数据库连接
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
