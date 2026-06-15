/**
 * 基金收益管理系统 - 后端服务
 * 支持账户分组、基金搜索、实时收益计算
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = 3801;

// 数据文件路径
const ACCOUNTS_FILE = path.join(__dirname, '../database/accounts.json');
const HOLDINGS_FILE = path.join(__dirname, '../database/holdings.json');

// 基金列表缓存
let fundListCache = null;
let fundListCacheTime = 0;
const FUND_LIST_CACHE_DURATION = 60 * 60 * 1000; // 1小时

// 基金实时数据缓存
const fundPriceCache = new Map();
const FUND_PRICE_CACHE_DURATION = 10 * 60 * 1000; // 10分钟

// 确保数据库目录存在
const dbDir = path.dirname(ACCOUNTS_FILE);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 初始化数据文件
function initDataFiles() {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(HOLDINGS_FILE)) {
    fs.writeFileSync(HOLDINGS_FILE, JSON.stringify([], null, 2));
  }
}

// 读取账户数据
function readAccounts() {
  initDataFiles();
  try {
    const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// 保存账户数据
function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

// 读取持仓数据
function readHoldings() {
  initDataFiles();
  try {
    const data = fs.readFileSync(HOLDINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// 保存持仓数据
function saveHoldings(holdings) {
  fs.writeFileSync(HOLDINGS_FILE, JSON.stringify(holdings, null, 2));
}

// 中间件
app.use(cors());
app.use(express.json({ extended: true, limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ========== 基金实时价格 API ==========

/**
 * 获取单个基金的实时估值
 */
async function getFundPrice(code) {
  // 检查缓存
  const cached = fundPriceCache.get(code);
  if (cached && Date.now() - cached.time < FUND_PRICE_CACHE_DURATION) {
    return cached.data;
  }

  try {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const response = await fetch(url, { timeout: 5000 });
    const text = await response.text();
    
    const match = text.match(/jsonpgz\((.*)\)/);
    if (match) {
      const data = JSON.parse(match[1]);
      const result = {
        code: data.fundcode,
        name: data.name,
        netWorth: parseFloat(data.dwjz) || 0,        // 单位净值（昨日）
        totalWorth: parseFloat(data.dwjz) || 0,      // 累计净值
        estimatedWorth: parseFloat(data.gsz) || 0,   // 估算净值（今日）
        estimatedGrowth: parseFloat(data.gsz === '' ? 0 : data.gszzl) || 0, // 估算增长率
        updateTime: data.gztime || ''
      };
      
      // 更新缓存
      fundPriceCache.set(code, { data: result, time: Date.now() });
      return result;
    }
  } catch (error) {
    console.error(`获取基金 ${code} 价格失败:`, error.message);
  }
  
  return null;
}

/**
 * 批量获取基金价格
 */
async function getFundPrices(codes) {
  const results = {};
  const uniqueCodes = [...new Set(codes.filter(c => c))];
  
  // 并行获取，最多同时请求5个
  const batchSize = 5;
  for (let i = 0; i < uniqueCodes.length; i += batchSize) {
    const batch = uniqueCodes.slice(i, i + batchSize);
    const promises = batch.map(code => getFundPrice(code));
    const batchResults = await Promise.all(promises);
    
    batch.forEach((code, index) => {
      if (batchResults[index]) {
        results[code] = batchResults[index];
      }
    });
    
    // 避免请求过快
    if (i + batchSize < uniqueCodes.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}

// ========== 基金搜索 API ==========

/**
 * 获取天天基金列表数据
 */
async function fetchFundList() {
  if (fundListCache && Date.now() - fundListCacheTime < FUND_LIST_CACHE_DURATION) {
    return fundListCache;
  }

  try {
    const allFunds = [];
    const pages = ['1,100', '2,100', '3,100', '4,100', '5,100'];
    
    for (const page of pages) {
      const url = `https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&onlySale=0&gs=0&gztime=last&page=${page},&sort=jjjz,desc&_=${Date.now()}`;
      const response = await fetch(url);
      const text = await response.text();
      
      const jsonStr = text.replace(/^var db=/, '').replace(/;$/, '');
      const db = new Function(`return ${jsonStr}`)();
      
      if (db.datas && Array.isArray(db.datas)) {
        const funds = db.datas.map(item => ({
          code: item[0] || '',
          name: item[1] || '',
          namePinyin: item[2] || '',
          netWorth: parseFloat(item[3]) || 0,
          totalWorth: parseFloat(item[4]) || 0,
          dailyGrowth: parseFloat(item[7]) || 0,
          dailyGrowthRate: parseFloat(item[8]) || 0
        }));
        allFunds.push(...funds);
      }
    }
    
    fundListCache = allFunds;
    fundListCacheTime = Date.now();
    console.log(`基金列表已更新，共 ${fundListCache.length} 只基金`);
    return fundListCache;
  } catch (error) {
    console.error('获取基金列表失败:', error);
  }
  
  return [];
}

/**
 * 搜索基金 - 支持基金代码和名称搜索
 */
app.get('/api/fund/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword || keyword.length < 1) {
      return res.json({ success: true, data: [] });
    }
    
    const funds = [];
    const keywordLower = keyword.toLowerCase();
    
    // 1. 首先尝试按基金代码搜索
    const codeMatch = keyword.match(/\d{6}/);
    if (codeMatch) {
      const price = await getFundPrice(codeMatch[0]);
      if (price) {
        funds.push({
          code: price.code,
          name: price.name,
          type: '',
          netWorth: price.netWorth,
          dailyGrowth: price.estimatedGrowth
        });
      }
    }
    
    // 2. 使用基金列表进行名称搜索
    if (funds.length === 0 && keyword.length >= 1) {
      const fundList = await fetchFundList();
      
      for (const fund of fundList) {
        if (fund.name.includes(keyword) ||
            fund.name.toLowerCase().includes(keywordLower) ||
            fund.namePinyin.toLowerCase().includes(keywordLower)) {
          funds.push({
            code: fund.code,
            name: fund.name,
            type: '',
            netWorth: fund.netWorth,
            dailyGrowth: fund.dailyGrowthRate
          });
          
          if (funds.length >= 20) break;
        }
      }
    }
    
    res.json({ success: true, data: funds });
  } catch (error) {
    console.error('搜索基金失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== 账户管理 API ==========

app.get('/api/accounts', (req, res) => {
  try {
    const accounts = readAccounts();
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/accounts', (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '账户名称不能为空' });
    }
    
    const accounts = readAccounts();
    const newAccount = {
      id: 'A' + Date.now(),
      name,
      description: description || '',
      created_at: new Date().toISOString()
    };
    
    accounts.push(newAccount);
    saveAccounts(accounts);
    
    res.json({ success: true, data: newAccount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/accounts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    const accounts = readAccounts();
    const index = accounts.findIndex(a => a.id === id);
    
    if (index >= 0) {
      accounts[index] = {
        ...accounts[index],
        name: name || accounts[index].name,
        description: description !== undefined ? description : accounts[index].description
      };
      saveAccounts(accounts);
      res.json({ success: true, data: accounts[index] });
    } else {
      res.status(404).json({ success: false, message: '账户不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    let accounts = readAccounts();
    accounts = accounts.filter(a => a.id !== id);
    saveAccounts(accounts);
    
    let holdings = readHoldings();
    holdings = holdings.filter(h => h.account_id !== id);
    saveHoldings(holdings);
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== 持仓管理 API ==========

app.get('/api/holdings/:accountId', (req, res) => {
  try {
    const { accountId } = req.params;
    const holdings = readHoldings().filter(h => h.account_id === accountId);
    res.json({ success: true, data: holdings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/holdings', (req, res) => {
  try {
    const holdings = readHoldings();
    const accounts = readAccounts();
    res.json({ success: true, data: holdings, accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/holdings', (req, res) => {
  try {
    const { account_id, fund_code, fund_name, cost, profit, purchase_date, before_315 } = req.body;
    
    if (!account_id || !fund_name || cost === undefined) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    
    const accounts = readAccounts();
    const account = accounts.find(a => a.id === account_id);
    if (!account) {
      return res.status(404).json({ success: false, message: '账户不存在' });
    }
    
    const holdings = readHoldings();
    const newHolding = {
      id: 'H' + Date.now(),
      account_id,
      fund_code: fund_code || '',
      fund_name,
      cost: parseFloat(cost),
      profit: profit !== undefined ? parseFloat(profit) : 0,
      purchase_date: purchase_date || new Date().toISOString().split('T')[0],
      before_315: before_315 !== undefined ? Boolean(before_315) : true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    holdings.push(newHolding);
    saveHoldings(holdings);
    
    res.json({ success: true, data: newHolding });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/holdings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { fund_code, fund_name, cost, profit, purchase_date, before_315 } = req.body;
    
    const holdings = readHoldings();
    const index = holdings.findIndex(h => h.id === id);
    
    if (index >= 0) {
      holdings[index] = {
        ...holdings[index],
        fund_code: fund_code !== undefined ? fund_code : holdings[index].fund_code,
        fund_name: fund_name || holdings[index].fund_name,
        cost: cost !== undefined ? parseFloat(cost) : holdings[index].cost,
        profit: profit !== undefined ? parseFloat(profit) : holdings[index].profit,
        purchase_date: purchase_date || holdings[index].purchase_date,
        before_315: before_315 !== undefined ? Boolean(before_315) : holdings[index].before_315,
        updated_at: new Date().toISOString()
      };
      saveHoldings(holdings);
      res.json({ success: true, data: holdings[index] });
    } else {
      res.status(404).json({ success: false, message: '持仓不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/holdings/:id', (req, res) => {
  try {
    const { id } = req.params;
    let holdings = readHoldings();
    holdings = holdings.filter(h => h.id !== id);
    saveHoldings(holdings);
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== 概览 API ==========

function calculateConfirmDate(purchaseDate, before315) {
  const date = new Date(purchaseDate);
  if (!before315) {
    date.setDate(date.getDate() + 1);
  }
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString().split('T')[0];
}

function isHoldingConfirmed(holding) {
  const today = new Date().toISOString().split('T')[0];
  const confirmDate = calculateConfirmDate(holding.purchase_date, holding.before_315);
  return confirmDate <= today;
}

// 获取概览 - 包含实时当日收益
app.get('/api/overview', async (req, res) => {
  try {
    const accounts = readAccounts();
    const holdings = readHoldings();
    
    // 获取所有基金的实时价格
    const allCodes = [...new Set(holdings.map(h => h.fund_code).filter(c => c))];
    const prices = await getFundPrices(allCodes);
    
    let totalCost = 0;
    let totalProfit = 0;
    let totalTodayProfit = 0;
    
    // 按账户分组
    const accountsWithHoldings = accounts.map(account => {
      const accountHoldings = holdings.filter(h => h.account_id === account.id);
      
      let accountTodayProfit = 0;
      
      // 计算每个持仓的当日收益
      const holdingsWithToday = accountHoldings.map(h => {
        const price = prices[h.fund_code];
        let todayProfit = 0;
        let currentValue = h.cost + h.profit;
        
        if (price && isHoldingConfirmed(h)) {
          // 当日收益 = 持有金额 * 估算增长率 / 100
          todayProfit = h.cost * price.estimatedGrowth / 100;
          currentValue = h.cost * (1 + price.estimatedGrowth / 100);
        }
        
        accountTodayProfit += todayProfit;
        
        return {
          ...h,
          todayProfit: todayProfit,
          currentValue: currentValue,
          price: price
        };
      });
      
      // 累计收益 = 用户输入的累计收益 + 当日收益
      const accountProfit = accountHoldings.reduce((sum, h) => sum + h.profit, 0) + accountTodayProfit;
      const accountCost = accountHoldings.reduce((sum, h) => sum + h.cost, 0);
      const accountValue = accountCost + accountProfit;
      const accountProfitRate = accountCost ? (accountProfit / accountCost) * 100 : 0;
      
      totalCost += accountCost;
      totalProfit += accountProfit;
      totalTodayProfit += accountTodayProfit;
      
      return {
        ...account,
        holdings: holdingsWithToday,
        totalCost: accountCost,
        totalProfit: accountProfit,
        totalValue: accountValue,
        profitRate: accountProfitRate,
        todayProfit: accountTodayProfit,
        todayProfitRate: accountCost ? (accountTodayProfit / accountCost) * 100 : 0
      };
    });
    
    const totalValue = totalCost + totalProfit;
    const totalProfitRate = totalCost ? (totalProfit / totalCost) * 100 : 0;
    const todayProfitRate = totalCost ? (totalTodayProfit / totalCost) * 100 : 0;
    
    res.json({
      success: true,
      data: {
        summary: {
          totalCost,
          totalValue,
          totalProfit,
          totalProfitRate,
          todayProfit: totalTodayProfit,
          todayProfitRate,
          accountsCount: accounts.length,
          holdingsCount: holdings.length,
          updateTime: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        },
        accounts: accountsWithHoldings
      }
    });
  } catch (error) {
    console.error('概览获取失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   基金收益管理系统已启动                                  ║
║                                                           ║
║   地址: http://localhost:${PORT}                             ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
