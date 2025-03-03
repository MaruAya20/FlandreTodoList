const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// 设置日志文件
const logFile = path.join(app.getPath('userData'), 'app.log');
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}\n`;
  console.log(logMessage);
  fs.appendFileSync(logFile, logMessage);
}

// 清理旧日志
try {
  if (fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, ''); // 清空日志文件
  }
} catch (error) {
  console.error('Error clearing log file:', error);
}

let db;
let mainWindow; // 保存主窗口的引用

// 创建数据库并打开
function initDb() {
  db = new sqlite3.Database('./todos.db', (err) => {
    if (err) { 
      console.error('Failed to connect to database:', err.message); // 修改这里，打印详细的错误信息
      return; // 如果数据库连接失败，就停止执行
    }
    console.log('Connected to SQLite database');
    // 创建 todos 表，添加 display_order 字段
    db.run(`CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      completed BOOLEAN DEFAULT 0,
      display_order INTEGER
    )`);
  });
}

// 获取所有待办事项，按照 display_order 排序
ipcMain.handle('get-todos', (event) => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM todos ORDER BY display_order ASC', [], (err, rows) => {
      if (err) {
        reject(err); // 如果查询失败，返回错误
      } else {
        resolve(rows); // 如果查询成功，返回数据
      }
    });
  });
});

// 添加新的待办事项时设置 display_order
ipcMain.handle('add-todo', (event, content) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT MAX(display_order) as maxOrder FROM todos', [], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      const newOrder = (row.maxOrder || 0) + 1;
      db.run('INSERT INTO todos (content, display_order) VALUES (?, ?)', 
        [content, newOrder], 
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ id: this.lastID, content, completed: 0, display_order: newOrder });
          }
        }
      );
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

// 处理任务重排序
ipcMain.handle('reorder-todos', (event, draggedId, dropZoneId) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 开始事务
      db.run('BEGIN TRANSACTION');

      // 获取拖动项和目标项的顺序
      db.get(
        'SELECT display_order as draggedOrder FROM todos WHERE id = ?',
        [draggedId],
        (err, draggedRow) => {
          if (err) {
            db.run('ROLLBACK');
            reject(err);
            return;
          }

          db.get(
            'SELECT display_order as dropOrder FROM todos WHERE id = ?',
            [dropZoneId],
            (err, dropRow) => {
              if (err) {
                db.run('ROLLBACK');
                reject(err);
                return;
              }

              const draggedOrder = draggedRow.draggedOrder;
              const dropOrder = dropRow.dropOrder;

              // 更新受影响项的顺序
              if (draggedOrder < dropOrder) {
                db.run(
                  `UPDATE todos 
                   SET display_order = display_order - 1 
                   WHERE display_order > ? AND display_order <= ?`,
                  [draggedOrder, dropOrder],
                  (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      reject(err);
                      return;
                    }
                  }
                );
              } else {
                db.run(
                  `UPDATE todos 
                   SET display_order = display_order + 1 
                   WHERE display_order >= ? AND display_order < ?`,
                  [dropOrder, draggedOrder],
                  (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      reject(err);
                      return;
                    }
                  }
                );
              }

              // 更新拖动项的顺序
              db.run(
                'UPDATE todos SET display_order = ? WHERE id = ?',
                [dropOrder, draggedId],
                (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    reject(err);
                  } else {
                    db.run('COMMIT');
                    resolve();
                  }
                }
              );
            }
          );
        }
      );
    });
  });
});

// 创建主窗口
function createWindow() {
  console.log('Starting window creation...');
  
  // 创建窗口
  mainWindow = new BrowserWindow({
    width: 790,
    height: 980,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // 在窗口完全加载后读取主题
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript('localStorage.getItem("theme")')
      .then(theme => {
        console.log('Stored theme:', theme);
        const isDark = theme === 'dark';
        updateWindowIcon(isDark);
      })
      .catch(error => {
        console.error('Error reading theme:', error);
      });
  });

  mainWindow.loadFile('index.html');
}

// 获取图标路径的辅助函数
function getIconPath(isDark = false) {
  const iconName = isDark ? 'icon_dairi03.ico' : 'icon_dairi02.ico';
  const iconPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'icon', iconName)
    : path.join(__dirname, 'icon', iconName);
  
  // 详细的路径信息日志
  log('=== Icon Path Debug Info ===');
  log(`Icon name: ${iconName}`);
  log(`Icon full path: ${iconPath}`);
  log(`App is packaged: ${app.isPackaged}`);
  log(`Resources path: ${process.resourcesPath}`);
  log(`Current directory: ${__dirname}`);
  log(`Process execution path: ${process.execPath}`);
  log(`File exists: ${fs.existsSync(iconPath)}`);
  
  // 如果文件不存在，列出目录内容
  if (!fs.existsSync(iconPath)) {
    log('=== Directory Content ===');
    const dirPath = app.isPackaged ? process.resourcesPath : __dirname;
    try {
      const files = fs.readdirSync(path.join(dirPath, 'icon'));
      log(`Files in icon directory: ${JSON.stringify(files)}`);
    } catch (error) {
      log(`Error reading icon directory: ${error.message}`);
    }
  }
  
  return iconPath;
}

// 更新窗口图标的辅助函数
async function updateWindowIcon(isDark) {
  log('=== Update Window Icon Debug Info ===');
  log(`Updating icon for dark theme: ${isDark}`);
  
  const iconPath = getIconPath(isDark);
  
  try {
    // 更新窗口图标
    log('Attempting to set window icon...');
    mainWindow.setIcon(iconPath);
    log('Window icon set successfully');

    // 在 Windows 上，尝试更新任务栏图标
    if (process.platform === 'win32') {
      log('=== Windows Taskbar Update Debug Info ===');
      log('Attempting to refresh taskbar icon...');
      
      // 使用 setUserTasks 强制刷新任务栏图标
      app.setUserTasks([
        {
          program: process.execPath,
          arguments: '',
          iconPath: iconPath,
          iconIndex: 0,
          title: 'FlandreTodoList',
          description: 'Refresh taskbar icon'
        }
      ]);
      
      // 清除任务
      setTimeout(() => {
        app.setUserTasks([]);
      }, 1000);
      
      // 保存窗口位置和大小
      const bounds = mainWindow.getBounds();
      
      // 强制刷新任务栏图标
      mainWindow.setSkipTaskbar(true);
      mainWindow.setOverlayIcon(null, '');
      mainWindow.setThumbarButtons([]);
      
      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 恢复任务栏图标
      mainWindow.setSkipTaskbar(false);
      
      // 重新设置窗口位置和大小
      mainWindow.setBounds(bounds);
      
      // 重新加载应用图标
      if (app.isPackaged) {
        log('=== Shortcut Update Debug Info ===');
        const { shell } = require('electron');
        const appPath = process.execPath;
        
        // 更新所有可能的快捷方式位置
        const possiblePaths = [
          // 所有用户的开始菜单
          path.join(process.env.PROGRAMDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'FlandreTodoList'),
          // 当前用户的开始菜单
          path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'FlandreTodoList'),
          // 所有用户的程序菜单
          path.join(process.env.PROGRAMDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
          // 当前用户的程序菜单
          path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
          // 公共桌面
          path.join(process.env.PUBLIC, 'Desktop'),
          // 用户桌面
          path.join(process.env.USERPROFILE, 'Desktop')
        ];

        log('Checking possible shortcut locations...');
        
        for (const basePath of possiblePaths) {
          try {
            if (fs.existsSync(basePath)) {
              log(`Checking path: ${basePath}`);
              
              // 检查目录中的所有 .lnk 文件
              const files = fs.readdirSync(basePath);
              for (const file of files) {
                if (file.toLowerCase().includes('flandretodolist') && file.endsWith('.lnk')) {
                  const shortcutPath = path.join(basePath, file);
                  log(`Found shortcut: ${shortcutPath}`);
                  
                  try {
                    shell.writeShortcutLink(shortcutPath, {
                      target: appPath,
                      icon: iconPath,
                      iconIndex: 0
                    });
                    log(`Updated shortcut: ${shortcutPath}`);
                  } catch (shortcutError) {
                    log(`Error updating shortcut ${shortcutPath}: ${shortcutError.message}`);
                  }
                }
              }
            }
          } catch (error) {
            log(`Error checking path ${basePath}: ${error.message}`);
          }
        }
        
        // 尝试刷新 Windows 图标缓存
        try {
          const { execSync } = require('child_process');
          log('Attempting to refresh Windows icon cache...');
          execSync('ie4uinit.exe -show');
          log('Windows icon cache refresh command executed');
        } catch (error) {
          log(`Error refreshing Windows icon cache: ${error.message}`);
        }
      } else {
        log('App is not packaged, skipping shortcut updates');
      }
    }
    
    log('Icon update process completed');
  } catch (error) {
    log(`Error in updateWindowIcon: ${error.message}`);
  }
}

// 添加切换图标的IPC处理器
ipcMain.handle('change-window-icon', (event, isDark) => {
  log(`Changing window icon, isDark: ${isDark}`);
  updateWindowIcon(isDark);
});

app.whenReady().then(() => {
  initDb();  // 初始化数据库连接
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});