/**
 * 测试自动获取 Cursor Token 的脚本
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');

// Use asm.js version (pure JavaScript, no WASM)
const initSqlJs = require('./node_modules/sql.js/dist/sql-asm.js');

// 获取数据库路径
function getCursorDbPath() {
  const homeDir = os.homedir();
  const platform = os.platform();

  if (platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  } else {
    return path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
}

// 从 SQLite 读取 token (使用 sql.js asm.js 版本)
async function readTokenFromSqlite() {
  const dbPath = getCursorDbPath();
  
  console.log('📁 数据库路径:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    console.error('❌ 数据库文件不存在');
    return null;
  }

  console.log('✅ 数据库文件存在');

  try {
    console.log('📦 加载 sql.js (asm.js 版本)...');
    const SQL = await initSqlJs();
    console.log('✅ sql.js 加载成功');
    
    const fileBuffer = fs.readFileSync(dbPath);
    console.log(`📊 数据库大小: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    const db = new SQL.Database(fileBuffer);
    console.log('✅ 数据库打开成功');
    
    const result = db.exec("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'");
    db.close();
    
    if (result.length > 0 && result[0].values.length > 0) {
      console.log('✅ 找到 accessToken');
      return result[0].values[0][0];
    } else {
      console.error('❌ 未找到 accessToken');
      return null;
    }
  } catch (error) {
    console.error('❌ 读取数据库失败:', error.message);
    return null;
  }
}

// 从 JWT 提取 userId
function extractUserId(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('❌ Token 格式不正确，不是 JWT');
      return null;
    }

    // 解码 base64url
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString());
    console.log('📋 JWT Payload:', JSON.stringify(payload, null, 2));
    
    if (payload.sub) {
      const match = payload.sub.match(/user_[A-Za-z0-9]+/);
      if (match) {
        return match[0];
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ 解析 JWT 失败:', error.message);
    return null;
  }
}

// 测试 API 调用
function testApiCall(userId, token) {
  return new Promise((resolve) => {
    const cookieValue = `${userId}%3A%3A${token}`;
    
    const options = {
      hostname: 'cursor.com',
      port: 443,
      path: `/api/usage?user=${userId}`,
      method: 'GET',
      headers: {
        'Cookie': `WorkosCursorSessionToken=${cookieValue}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Origin': 'https://cursor.com',
        'Referer': 'https://cursor.com/cn/dashboard'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, data });
      });
    });

    req.on('error', (error) => {
      resolve({ error: error.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ error: 'Request timed out' });
    });

    req.end();
  });
}

// 主函数
async function main() {
  console.log('========================================');
  console.log('🔍 Cursor Token 自动获取测试');
  console.log('========================================\n');

  // 步骤 1: 读取 token
  console.log('【步骤 1】从 SQLite 数据库读取 Token\n');
  const token = await readTokenFromSqlite();
  
  if (!token) {
    console.log('\n❌ 测试失败：无法获取 token');
    process.exit(1);
  }
  
  console.log('   Token 前 50 字符:', token.substring(0, 50) + '...');
  console.log('   Token 长度:', token.length);

  // 步骤 2: 提取 userId
  console.log('\n【步骤 2】从 JWT 提取 User ID\n');
  const userId = extractUserId(token);
  
  if (!userId) {
    console.log('\n❌ 测试失败：无法提取 userId');
    process.exit(1);
  }
  
  console.log('✅ User ID:', userId);

  // 步骤 3: 测试 API
  console.log('\n【步骤 3】测试 Cursor API 调用\n');
  console.log('   请求 URL: https://cursor.com/api/usage?user=' + userId);
  
  const result = await testApiCall(userId, token);
  
  if (result.error) {
    console.log('❌ API 调用失败:', result.error);
    process.exit(1);
  }
  
  console.log('   HTTP 状态码:', result.statusCode);
  
  if (result.statusCode === 200) {
    console.log('✅ API 调用成功!');
    try {
      const usage = JSON.parse(result.data);
      console.log('\n📊 使用量数据:');
      console.log(JSON.stringify(usage, null, 2));
    } catch {
      console.log('   响应数据:', result.data.substring(0, 200));
    }
  } else if (result.statusCode === 401 || result.statusCode === 403) {
    console.log('❌ 认证失败，token 可能已过期');
    console.log('   响应:', result.data);
  } else {
    console.log('⚠️  非预期的状态码');
    console.log('   响应:', result.data.substring(0, 200));
  }

  console.log('\n========================================');
  console.log('✅ 测试完成');
  console.log('========================================');
}

main().catch(console.error);
