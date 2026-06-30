# 中医门诊预约小程序

## 项目结构

```
├── miniprogram/          # 微信小程序（患者端 + 技师端）
│   ├── pages/            # 页面
│   ├── components/       # 组件
│   ├── utils/            # 工具函数
│   └── images/           # 图片资源
├── cloudfunctions/       # 云函数
│   ├── login/            # 登录 + 角色识别
│   ├── getServices/      # 获取服务列表
│   ├── getAvailableSlots/# 获取可用时段
│   ├── createAppointment/# 创建预约
│   ├── cancelAppointment/# 取消预约
│   ├── verifyAppointment/# 核销预约
│   ├── getAppointments/  # 获取预约列表
│   ├── getMyAppointments/# 获取我的预约
│   ├── getArticles/      # 获取文章
│   ├── getArticleDetail/ # 获取文章详情
│   ├── sendReminder/     # 预约提醒
│   └── admin/            # 管理后台接口（统一入口）
└── admin-web/            # H5管理后台（Vue 3 + Element Plus）
    └── src/
        ├── views/        # 页面
        ├── api/          # API接口（@cloudbase/js-sdk 调用云函数）
        └── router/       # 路由
```

## 架构说明

```
┌──────────────────────────────────┐
│        微信小程序                  │
│  ┌────────────┐ ┌─────────────┐  │
│  │  患者端     │ │  技师端      │  │
│  └────────────┘ └─────────────┘  │
└──────────────┬───────────────────┘
               │ wx.cloud.callFunction
      ┌────────▼────────┐
      │   微信云开发      │
      │  云函数 + 云数据库 │
      │  + 云存储         │
      └────────┬────────┘
               │ @cloudbase/js-sdk (callFunction)
      ┌────────▼────────┐
      │  管理后台（H5）   │
      │  Vue3 + Element  │
      └─────────────────┘
```

**小程序端** 使用 `wx.cloud.callFunction` 调用云函数。
**管理后台 H5 端** 使用 `@cloudbase/js-sdk` 的 `app.callFunction` 调用同一个云函数。

> H5 端无法使用 `wx.cloud`（仅限小程序内），必须用 `@cloudbase/js-sdk`。
> 参考：[CloudBase JS SDK 官方文档](https://docs.cloudbase.net/api-reference/webv2/functions)

## 部署步骤

### 1. 小程序部署

1. 使用微信开发者工具打开项目
2. 在 `project.config.json` 中替换 `appid` 为你的小程序 AppID
3. 在 `miniprogram/app.js` 中替换 `env` 为你的云开发环境 ID
4. 安装依赖：在 `miniprogram` 目录下执行 `npm install`
5. 在微信开发者工具中点击"工具" -> "构建 npm"
6. 上传并部署小程序

### 2. 云函数部署

在微信开发者工具中，右键点击每个云函数目录，选择"上传并部署：云端安装依赖"。

需要部署的云函数：
- login、getServices、getAvailableSlots、createAppointment
- cancelAppointment、verifyAppointment、getAppointments、getMyAppointments
- getArticles、getArticleDetail、sendReminder、admin

### 3. 数据库初始化

在云开发控制台创建以下集合：

- `users` - 用户表
- `services` - 服务项目表
- `technicians` - 技师表
- `appointments` - 预约表
- `business_config` - 营业配置表
- `holidays` - 休假日表
- `tech_days_off` - 技师休假表
- `articles` - 文章表
- `commission_records` - 提成记录表
- `login_sessions` - 扫码登录会话表（5 分钟有效）
- `admin_sessions` - 管理后台登录态 token 表（24 小时有效）
- `admin_users` - 扫码登录白名单（OpenID）

### 4. 管理后台部署

1. 进入 `admin-web` 目录
2. 安装依赖：`npm install`
3. 开发模式：`npm run dev`
4. 构建生产版本：`npm run build`
5. 将 `dist` 目录上传到云开发静态网站托管
6. **重要：** 在云开发控制台确认已开启匿名登录（管理后台 H5 端通过匿名登录调用云函数）

### 5. 管理后台扫码登录配置

管理后台的登录/绑定二维码由 `admin` 云函数生成真正的微信小程序码，扫码后直接进入：

```
pages/scan-confirm/scan-confirm
```

小程序端进入确认页后会自动调用 `confirmLoginSession`，成功后直接提示登录确认或微信绑定成功。

配置步骤：

1. 在微信公众平台获取小程序 `AppID` 和 `AppSecret`
2. 将下面环境变量配置到 `admin` 云函数，不要写进前端代码

```
WECHAT_APPID=你的 AppID
WECHAT_APPSECRET=你的 AppSecret
WECHAT_MINIPROGRAM_QR_ENV_VERSION=trial
```

3. 测试体验版时使用 `trial`
4. 小程序正式发布后，将 `WECHAT_MINIPROGRAM_QR_ENV_VERSION` 改为 `release`
5. 部署 `admin` 云函数
6. 重新构建并部署管理后台

> 管理后台“管理员账号”页可创建账号、设置角色并生成绑定微信的小程序码。绑定后，该微信可用于扫码登录后台。

需要额外创建集合：

- `login_sessions`：临时扫码登录会话，二维码 5 分钟有效
- `admin_sessions`：管理后台登录态，默认 24 小时有效
- `admin_users`：管理员账号、角色和绑定微信 OpenID

小程序码通过 `scene` 传递 `session_id`。确认时云函数会校验扫码微信是否已绑定到启用的管理员账号，通过后给管理端签发后台登录 token。

### 6. 订阅消息配置

1. 在微信公众平台申请订阅消息模板
2. 模板需要包含：预约成功通知、预约取消通知、核销完成通知、预约提醒通知
3. 在云函数中替换 `templateId` 为你的模板 ID

## 功能说明

### 患者端

- **首页**：停业公告、门诊信息、健康小知识
- **预约**：选择服务项目 -> 选择日期 -> 选择时段 -> 确认预约
- **我的**：用户信息、店铺导航、预约列表、预约详情（含太阳码）

### 技师端

- **今日预约**：查看今日待核销预约
- **扫码核销**：扫描患者太阳码完成核销
- **核销记录**：查看今日已核销记录

### 管理后台

- **仪表盘**：今日预约统计
- **预约管理**：查看所有预约
- **客户管理**：客户列表、黑名单、备注
- **技师管理**：添加技师、设置提成
- **服务管理**：服务项目增删改
- **营业设置**：店铺信息、营业时间
- **休息管理**：店铺停业、技师休假
- **提成统计**：提成明细和汇总
- **健康小知识**：文章管理（封面图上传使用云存储）

## 注意事项

1. **环境 ID**：小程序 `app.js` 和管理后台 `api/cloudbase.js` 中的环境 ID 必须一致
2. **匿名登录**：管理后台 H5 端依赖匿名登录调用云函数，需在云开发控制台开启
3. **订阅消息模板 ID**：需要在微信公众平台申请
4. **云存储权限**：确保云存储的读写权限配置正确
5. **数据库权限**：确保各集合的权限设置为"仅创建者可读写"或自定义安全规则

## 常见问题

### 1. 管理后台 H5 调不通云函数

- 确认云开发控制台已开启匿名登录
- 确认 `api/cloudbase.js` 中的环境 ID 正确
- F12 查看控制台是否有跨域或鉴权错误

### 2. 小程序码生成失败

检查云开发环境是否开通了"小程序码"能力，并确保云函数有权限调用 `wxacode.getUnlimited`。

### 3. 订阅消息发送失败

- 确保用户已授权订阅消息
- 确保模板 ID 正确
- 确保消息内容符合模板要求

### 4. 时段计算不正确

检查 `business_config` 中的 `schedule` 配置是否正确，确保每天的营业时间格式正确。
