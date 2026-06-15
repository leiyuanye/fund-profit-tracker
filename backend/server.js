/**
 * 基金收益管理系统 - 后端服务
 * 支持账户分组、基金搜索、实时收益计算
 * 遵循基金交易规则：
 * - 基金按份额持有
 * - 当日收益 = 持有份额 × (当日净值 - 昨日净值)
 * - 累计收益 = 持有份额 × (当前净值 - 买入净值)
 * - 当前市值 = 持有份额 × 当前净值
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
 * 返回数据包含：
 * - netWorth: 昨日净值（用于计算当日收益）
 * - estimatedWorth: 估算净值（今日收盘价估算）
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
        netWorth: parseFloat(data.dwjz) || 0,        // 单位净值（昨日收盘净值）
        totalWorth: parseFloat(data.ljjz) || 0,      // 累计净值
        estimatedWorth: parseFloat(data.gsz) || 0,   // 估算净值（今日实时估算）
        estimatedGrowth: parseFloat(data.gsz === '' ? 0 : data.gszzl) || 0, // 估算增长率
        updateTime: data.gztime || ''                // 更新时间
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
 * 基金搜索多数据源配置
 * 可以配置多个搜索源，系统会自动合并去重
 */
const FUND_SEARCH_SOURCES = [
  {
    name: '天天基金实时',
    enabled: true,
    priority: 1,
    search: async (keyword) => {
      const funds = [];
      // 按基金代码搜索
      const codeMatch = keyword.match(/\d{6}/);
      if (codeMatch) {
        const price = await getFundPrice(codeMatch[0]);
        if (price) {
          funds.push({
            code: price.code,
            name: price.name,
            type: '',
            netWorth: price.netWorth,
            dailyGrowth: price.estimatedGrowth,
            source: '天天基金实时'
          });
        }
      }
      return funds;
    }
  },
  {
    name: '支付宝基金搜索',
    enabled: true,
    priority: 2,
    search: async (keyword) => {
      const funds = [];
      try {
        // 尝试不同的搜索接口
        const searchUrl = `https://fund.eastmoney.com/Interface/AllFundInterface?para=1&pageIndex=1&pageSize=1000&sort=JJJZ&order=desc&_=${Date.now()}`;
        const response = await fetch(searchUrl, {
          headers: {
            'Referer': 'https://fund.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (response.ok) {
          const text = await response.text();
          // 尝试解析JSON
          try {
            const data = JSON.parse(text);
            if (data.Data && Array.isArray(data.Data)) {
              const keywordLower = keyword.toLowerCase();
              for (const fund of data.Data) {
                if (fund.NAME && 
                    (fund.NAME.includes(keyword) || 
                     fund.NAME.toLowerCase().includes(keywordLower))) {
                  funds.push({
                    code: fund.CODE,
                    name: fund.NAME,
                    type: '',
                    netWorth: parseFloat(fund.JJJZ) || 0,
                    dailyGrowth: parseFloat(fund.Rate) || 0,
                    source: '天天基金数据'
                  });
                  if (funds.length >= 30) break;
                }
              }
            }
          } catch (parseError) {
            // JSON解析失败，尝试其他方式
          }
        }
      } catch (error) {
        console.error('支付宝搜索失败:', error.message);
      }
      return funds;
    }
  },
  {
    name: '天天基金列表搜索',
    enabled: true,
    priority: 3,
    search: async (keyword) => {
      const funds = [];
      const keywordLower = keyword.toLowerCase();
      const fundList = await fetchFundList();
      
      for (const fund of fundList) {
        if (fund.name.includes(keyword) ||
            fund.name.toLowerCase().includes(keywordLower) ||
            fund.namePinyin.toLowerCase().includes(keywordLower) ||
            fund.code.includes(keyword)) {
          funds.push({
            code: fund.code,
            name: fund.name,
            type: '',
            netWorth: fund.netWorth,
            dailyGrowth: fund.dailyGrowthRate,
            source: '天天基金列表'
          });
          
          if (funds.length >= 20) break;
        }
      }
      return funds;
    }
  },
  {
    name: '按代码范围搜索',
    enabled: true,
    priority: 4,
    search: async (keyword) => {
      const funds = [];
      // 如果关键词是纯数字，尝试搜索附近代码
      const codeMatch = keyword.match(/\d{4,6}/);
      if (codeMatch) {
        const baseCode = codeMatch[0].substring(0, 4);
        // 搜索0000-0099范围的基金
        for (let i = 0; i < 100; i += 10) {
          const searchCode = baseCode + String(i).padStart(2, '0');
          const price = await getFundPrice(searchCode);
          if (price && price.name) {
            funds.push({
              code: price.code,
              name: price.name,
              type: '',
              netWorth: price.netWorth,
              dailyGrowth: price.estimatedGrowth,
              source: '代码范围'
            });
          }
          if (funds.length >= 20) break;
        }
      }
      return funds;
    }
  }
];

/**
 * 搜索基金 - 多数据源合并去重
 */
app.get('/api/fund/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword || keyword.length < 1) {
      return res.json({ success: true, data: [] });
    }
    
    // 并行搜索所有启用的数据源
    const enabledSources = FUND_SEARCH_SOURCES.filter(s => s.enabled);
    const searchPromises = enabledSources.map(source => 
      source.search(keyword).catch(err => {
        console.error(`${source.name} 搜索失败:`, err.message);
        return [];
      })
    );
    
    const results = await Promise.all(searchPromises);
    
    // 合并所有结果并去重
    const fundMap = new Map();
    
    results.flat().forEach(fund => {
      if (!fund || !fund.code) return;
      
      const key = fund.code.toString().padStart(6, '0');
      
      // 如果已存在，保留优先级更高的
      if (!fundMap.has(key)) {
        fundMap.set(key, fund);
      }
    });
    
    // 转换为数组，最多返回30条
    const funds = Array.from(fundMap.values()).slice(0, 30);
    
    res.json({ success: true, data: funds });
  } catch (error) {
    console.error('搜索基金失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 获取基金历史净值
 * 根据指定日期获取当日的单位净值
 */
app.get('/api/fund/networth', async (req, res) => {
  try {
    const { code, date } = req.query;
    
    if (!code) {
      return res.status(400).json({ success: false, message: '基金代码不能为空' });
    }
    
    // 如果没有指定日期，返回实时净值
    if (!date) {
      const price = await getFundPrice(code);
      if (price) {
        return res.json({
          success: true,
          data: {
            netWorth: price.netWorth,
            totalWorth: price.totalWorth,
            date: new Date().toISOString().split('T')[0],
            isToday: true
          }
        });
      }
      return res.json({ success: false, message: '获取净值失败' });
    }
    
    // 获取指定日期的净值
    try {
      const targetDate = new Date(date);
      const startDate = targetDate.toISOString().split('T')[0];
      const endDate = startDate;
      
      const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=5&startDate=${startDate}&endDate=${endDate}`;
      
      const response = await fetch(url, {
        headers: {
          'Referer': 'https://fund.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const data = await response.json();
      
      if (data.Data && data.Data.LSJZList && data.Data.LSJZList.length > 0) {
        const record = data.Data.LSJZList[0];
        return res.json({
          success: true,
          data: {
            netWorth: parseFloat(record.DWJZ) || 0,
            totalWorth: parseFloat(record.LJJZ) || 0,
            date: record.FSRQ,
            isToday: false
          }
        });
      }
      
      // 如果没有找到该日期的数据，尝试获取最近的数据
      const latestUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=10`;
      const latestResponse = await fetch(latestUrl, {
        headers: {
          'Referer': 'https://fund.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      const latestData = await latestResponse.json();
      
      if (latestData.Data && latestData.Data.LSJZList && latestData.Data.LSJZList.length > 0) {
        // 找到比目标日期更早或相等的记录
        const targetTime = new Date(date).getTime();
        for (const record of latestData.Data.LSJZList) {
          const recordTime = new Date(record.FSRQ).getTime();
          if (recordTime <= targetTime) {
            return res.json({
              success: true,
              data: {
                netWorth: parseFloat(record.DWJZ) || 0,
                totalWorth: parseFloat(record.LJJZ) || 0,
                date: record.FSRQ,
                isToday: false,
                note: `最近可用净值（${date}非交易日）`
              }
            });
          }
        }
        
        // 返回最新的净值
        const latestRecord = latestData.Data.LSJZList[0];
        return res.json({
          success: true,
          data: {
            netWorth: parseFloat(latestRecord.DWJZ) || 0,
            totalWorth: parseFloat(latestRecord.LJJZ) || 0,
            date: latestRecord.FSRQ,
            isToday: false,
            note: `当前最新净值（${date}之前无可用数据）`
          }
        });
      }
      
      res.json({ success: false, message: '未找到净值数据' });
    } catch (error) {
      console.error('获取历史净值失败:', error);
      // 如果API失败，返回实时净值作为备选
      const price = await getFundPrice(code);
      if (price) {
        return res.json({
          success: true,
          data: {
            netWorth: price.netWorth,
            totalWorth: price.netWorth,
            date: new Date().toISOString().split('T')[0],
            isToday: true,
            note: '使用估算净值（历史接口不可用）'
          }
        });
      }
      res.status(500).json({ success: false, message: '获取净值失败' });
    }
  } catch (error) {
    console.error('获取净值异常:', error);
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

/**
 * 计算基金确认日期
 * - 15:00前买入：当日起算（遇节假日顺延）
 * - 15:00后买入：次日起算（遇节假日顺延）
 */
function calculateConfirmDate(purchaseDate, before315) {
  const date = new Date(purchaseDate);
  // 如果是15:00后买入，确认日期+1天
  if (!before315) {
    date.setDate(date.getDate() + 1);
  }
  // 跳过周末
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString().split('T')[0];
}

/**
 * 检查持仓是否已确认
 */
function isHoldingConfirmed(holding) {
  const today = new Date().toISOString().split('T')[0];
  const confirmDate = calculateConfirmDate(holding.purchase_date, holding.before_315);
  return confirmDate <= today;
}

/**
 * 获取指定日期的基金净值
 * 如果是历史日期，需要获取历史净值数据
 */
async function getHistoricalNetWorth(code, date) {
  // 优先使用缓存中的最新净值
  const cached = fundPriceCache.get(code);
  if (cached && cached.data.netWorth) {
    // 如果查询的是今天或昨天，返回缓存数据
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    if (date === todayStr || date === yesterdayStr) {
      return {
        netWorth: cached.data.netWorth,
        estimatedWorth: cached.data.estimatedWorth
      };
    }
  }
  
  // 尝试从天天基金获取历史净值
  try {
    const startDate = date.replace(/-/g, '');
    const endDate = date.replace(/-/g, '');
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1&startDate=${date}&endDate=${date}`;
    
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://fund.eastmoney.com/'
      }
    });
    const data = await response.json();
    
    if (data.Data && data.Data.LSJZList && data.Data.LSJZList.length > 0) {
      const record = data.Data.LSJZList[0];
      return {
        netWorth: parseFloat(record.DWJZ) || 0,
        totalWorth: parseFloat(record.LJJZ) || 0
      };
    }
  } catch (error) {
    console.error(`获取历史净值失败 ${code} ${date}:`, error.message);
  }
  
  return null;
}

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

/**
 * 添加持仓
 * 数据结构：
 * - buyAmount: 买入金额（元）
 * - buyNetWorth: 买入时的净值
 * - shares: 持有份额（系统自动计算：buyAmount / buyNetWorth）
 */
app.post('/api/holdings', async (req, res) => {
  try {
    const { account_id, fund_code, fund_name, buy_amount, buy_net_worth, profit, purchase_date, before_315 } = req.body;
    
    if (!account_id || !fund_name) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    
    const accounts = readAccounts();
    const account = accounts.find(a => a.id === account_id);
    if (!account) {
      return res.status(404).json({ success: false, message: '账户不存在' });
    }
    
    const holdings = readHoldings();
    
    // 计算持有份额
    const buyAmount = parseFloat(buy_amount) || 0;
    let buyNetWorth = parseFloat(buy_net_worth) || 1;
    let shares = 0;
    
    if (buyNetWorth > 0 && buyAmount > 0) {
      shares = buyAmount / buyNetWorth;
    }
    
    const newHolding = {
      id: 'H' + Date.now(),
      account_id,
      fund_code: fund_code || '',
      fund_name,
      buy_amount: buyAmount,      // 买入金额
      buy_net_worth: buyNetWorth, // 买入净值
      shares: shares,             // 持有份额
      profit: profit !== undefined ? parseFloat(profit) : 0, // 历史累计收益（用户手动输入的调整值）
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

/**
 * 更新持仓
 */
app.put('/api/holdings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { fund_code, fund_name, buy_amount, buy_net_worth, profit, purchase_date, before_315 } = req.body;
    
    const holdings = readHoldings();
    const index = holdings.findIndex(h => h.id === id);
    
    if (index >= 0) {
      // 重新计算份额
      const buyAmount = buy_amount !== undefined ? parseFloat(buy_amount) : holdings[index].buy_amount;
      const buyNetWorth = buy_net_worth !== undefined ? parseFloat(buy_net_worth) : holdings[index].buy_net_worth || 1;
      let shares = 0;
      
      if (buyNetWorth > 0 && buyAmount > 0) {
        shares = buyAmount / buyNetWorth;
      }
      
      holdings[index] = {
        ...holdings[index],
        fund_code: fund_code !== undefined ? fund_code : holdings[index].fund_code,
        fund_name: fund_name || holdings[index].fund_name,
        buy_amount: buyAmount,
        buy_net_worth: buyNetWorth,
        shares: shares,
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

/**
 * 计算基金收益（遵循基金交易规则）
 * 
 * 核心公式：
 * - 当前市值 = 持有份额 × 当前净值
 * - 累计收益 = 持有份额 × (当前净值 - 买入净值) + 历史调整收益
 * - 当日收益 = 持有份额 × (估算净值 - 昨日净值)
 */
function calculateFundProfit(holding, price) {
  const shares = holding.shares || 0;
  const buyNetWorth = holding.buy_net_worth || 1;
  
  // 如果没有实时价格，返回默认值
  if (!price) {
    return {
      currentValue: shares * buyNetWorth, // 估算当前市值
      totalProfit: holding.profit || 0,
      todayProfit: 0,
      profitRate: 0,
      todayProfitRate: 0
    };
  }
  
  // 当前净值（使用估算净值，如果没有则用昨日净值）
  const currentNetWorth = price.estimatedWorth || price.netWorth;
  const yesterdayNetWorth = price.netWorth;
  
  // ========== 收益计算 ==========
  
  // 1. 当前市值 = 持有份额 × 当前净值
  const currentValue = shares * currentNetWorth;
  
  // 2. 累计收益 = 持有份额 × (当前净值 - 买入净值) + 用户调整的历史收益
  // 注意：holding.profit 是用户手动输入的调整值（可能是为了修正分红等）
  const investment = shares * buyNetWorth; // 总投入
  const unrealizedProfit = shares * (currentNetWorth - buyNetWorth); // 浮动盈亏
  const totalProfit = unrealizedProfit + (holding.profit || 0);
  
  // 3. 累计收益率
  const profitRate = investment > 0 ? (totalProfit / investment) * 100 : 0;
  
  // 4. 当日收益 = 持有份额 × (估算净值 - 昨日净值)
  // 只有持仓已确认才计算当日收益
  const todayProfit = isHoldingConfirmed(holding) 
    ? shares * (price.estimatedWorth - yesterdayNetWorth)
    : 0;
  
  // 5. 当日收益率
  const todayProfitRate = yesterdayNetWorth > 0 
    ? ((price.estimatedWorth - yesterdayNetWorth) / yesterdayNetWorth) * 100 
    : 0;
  
  return {
    currentValue,
    totalProfit,
    todayProfit,
    profitRate,
    todayProfitRate,
    currentNetWorth,
    yesterdayNetWorth
  };
}

// 获取概览 - 包含实时当日收益
app.get('/api/overview', async (req, res) => {
  try {
    const accounts = readAccounts();
    const holdings = readHoldings();
    
    // 获取所有基金的实时价格
    const allCodes = [...new Set(holdings.map(h => h.fund_code).filter(c => c))];
    const prices = await getFundPrices(allCodes);
    
    let totalInvestment = 0;   // 总投入金额
    let totalCurrentValue = 0; // 总当前市值
    let totalProfit = 0;       // 总累计收益
    let totalTodayProfit = 0;  // 总当日收益
    
    // 按账户分组
    const accountsWithHoldings = accounts.map(account => {
      const accountHoldings = holdings.filter(h => h.account_id === account.id);
      
      let accountInvestment = 0;
      let accountCurrentValue = 0;
      let accountTotalProfit = 0;
      let accountTodayProfit = 0;
      
      // 计算每个持仓的收益
      const holdingsWithProfit = accountHoldings.map(h => {
        const price = prices[h.fund_code];
        const profitData = calculateFundProfit(h, price);
        
        // 累加到账户
        const investment = (h.shares || 0) * (h.buy_net_worth || 1);
        accountInvestment += investment;
        accountCurrentValue += profitData.currentValue;
        accountTotalProfit += profitData.totalProfit;
        accountTodayProfit += profitData.todayProfit;
        
        return {
          ...h,
          currentValue: profitData.currentValue,
          totalProfit: profitData.totalProfit,
          todayProfit: profitData.todayProfit,
          profitRate: profitData.profitRate,
          todayProfitRate: profitData.todayProfitRate,
          currentNetWorth: profitData.currentNetWorth,
          yesterdayNetWorth: profitData.yesterdayNetWorth,
          price: price,
          isConfirmed: isHoldingConfirmed(h)
        };
      });
      
      // 账户汇总
      const accountProfitRate = accountInvestment > 0 
        ? (accountTotalProfit / accountInvestment) * 100 
        : 0;
      const accountTodayProfitRate = holdingsWithProfit.length > 0 
        ? (accountTodayProfit / accountInvestment) * 100 
        : 0;
      
      // 累加到总计
      totalInvestment += accountInvestment;
      totalCurrentValue += accountCurrentValue;
      totalProfit += accountTotalProfit;
      totalTodayProfit += accountTodayProfit;
      
      return {
        ...account,
        holdings: holdingsWithProfit,
        totalInvestment: accountInvestment,
        totalCurrentValue: accountCurrentValue,
        totalProfit: accountTotalProfit,
        profitRate: accountProfitRate,
        todayProfit: accountTodayProfit,
        todayProfitRate: accountTodayProfitRate,
        holdingsCount: accountHoldings.length
      };
    });
    
    // 总计
    const totalProfitRate = totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;
    const totalTodayProfitRate = totalInvestment > 0 ? (totalTodayProfit / totalInvestment) * 100 : 0;
    
    res.json({
      success: true,
      data: {
        summary: {
          totalInvestment,       // 总投入
          totalCurrentValue,     // 总当前市值
          totalProfit,          // 总累计收益
          totalProfitRate,      // 累计收益率
          todayProfit: totalTodayProfit,    // 总当日收益
          todayProfitRate: totalTodayProfitRate, // 当日收益率
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
