# 📈 基金收益管理系统

[![GitHub stars](https://img.shields.io/github/stars/leiyuanye/fund-profit-tracker)](https://github.com/leiyuanye/fund-profit-tracker/stargazers)
[![GitHub license](https://img.shields.io/github/license/leiyuanye/fund-profit-tracker)](https://github.com/leiyuanye/fund-profit-tracker)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)

> 简洁明了，一眼看到当日收益的基金持仓管理工具

## ✨ 功能特点

- 📊 **当日收益突出显示** - 页面顶部醒目展示今日收益
- 💰 **实时估值** - 每30秒自动刷新基金实时估值
- 📈 **累计收益统计** - 成本、市值、收益率一目了然
- ➕ **便捷添加** - 输入基金代码快速添加持仓
- 🎨 **小程序风格** - 简洁美观的移动端友好界面

## 🚀 快速开始

### 前置要求

- Node.js >= 16.0.0

### 安装运行

```bash
# 克隆仓库
git clone https://github.com/leiyuanye/fund-profit-tracker.git
cd fund-profit-tracker

# 安装依赖
npm install

# 启动服务
npm start
```

然后打开浏览器访问: **http://localhost:3801**

## 📱 界面预览

```
┌────────────────────────────────┐
│ 📊 我的基金              15:30 │
├────────────────────────────────┤
│                                │
│       今日收益                 │
│       +486.84                 │  ← 醒目金色显示
│       +4.87%                  │
│                                │
├────────────────────────────────┤
│ 总市值    累计收益    收益率    │
│ 10485.19  +485.19    +4.85%   │
└────────────────────────────────┘

┌────────────────────────────────┐
│ 💼 持仓明细                    │
├────────────────────────────────┤
│ 嘉实半导体C            +486.84│
│ 014855               +4.87%  │
│ ────────────────────────────  │
│ 持有3289份  成本10000  市值10485│
└────────────────────────────────┘
```

## 🔧 API 接口

### 核心接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/overview` | GET | 获取收益概览（包含所有持仓的当日收益） |
| `/api/holdings` | GET | 获取持仓列表 |
| `/api/holdings` | POST | 添加持仓 |
| `/api/holdings/:code` | DELETE | 删除持仓 |
| `/api/fund/estimate/:code` | GET | 获取单只基金实时估值 |
| `/api/fund/history/:code` | GET | 获取基金历史净值 |

### 示例

```javascript
// 获取概览
fetch('http://localhost:3801/api/overview')

// 添加持仓
fetch('http://localhost:3801/api/holdings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fund_code: '014855',
    shares: 1000,
    cost: 10000
  })
})
```

## 📁 项目结构

```
fund-app/
├── backend/
│   └── server.js          # Node.js 后端服务
├── frontend/
│   └── index.html         # 前端页面
├── database/
│   └── holdings.json      # 持仓数据存储（自动创建）
├── package.json           # 项目配置
├── start.bat              # Windows 启动脚本
└── README.md
```

## 🛠️ 技术栈

- **后端**: Node.js + Express
- **数据库**: JSON 文件存储
- **前端**: 原生 HTML/CSS/JavaScript
- **数据源**: 天天基金 API

## ⚠️ 注意事项

1. 首次运行会自动创建数据库目录
2. 实时估值数据来自天天基金，仅供参考
3. 数据存储在 `database/holdings.json` 文件中
4. 如遇跨域问题，确保后端服务正常运行

## 📝 License

MIT

---

🌟 如果对你有帮助，请给个 Star！
