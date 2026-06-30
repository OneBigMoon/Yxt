const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const wechatTokenCache = { token: '', expireAt: 0 }
const REQUEST_TIMEOUT_MS = 8000
const MINI_PROGRAM_QR_SCENE_MAX_LENGTH = 32
const MINI_PROGRAM_PAGE_MAX_LENGTH = 128
const ADMIN_PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || 'yxt-admin-salt'
const ADMIN_BOOTSTRAP_USERNAME = process.env.ADMIN_BOOTSTRAP_USERNAME || ''
const ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || ''
const WECHAT_MINIPROGRAM_QR_ENV_VERSION = process.env.WECHAT_MINIPROGRAM_QR_ENV_VERSION || 'release'
const ADMIN_ROLE_OPTIONS = ['super_admin', 'manager', 'viewer']
const ADMIN_ACTION_PERMISSIONS = {
  super_admin: ['*'],
  manager: [
    'getServices', 'createService', 'updateService',
    'getTechnicians', 'createTechnician', 'updateTechnician', 'toggleTechnicianStatus',
    'getCustomers', 'updateCustomer', 'deleteCustomer', 'toggleBlacklist',
    'getAppointments', 'getAppointmentDetail',
    'getHolidays', 'addHoliday', 'deleteHoliday',
    'getTechDaysOff', 'addTechDayOff', 'deleteTechDayOff',
    'getCommissions', 'getCommissionSummary',
    'getArticles', 'createArticle', 'updateArticle', 'toggleArticleStatus',
    'updateConfig', 'importHolidays',
    'getCurrentAdmin'
  ],
  viewer: [
    'getServices',
    'getTechnicians',
    'getCustomers',
    'getAppointments', 'getAppointmentDetail',
    'getHolidays',
    'getTechDaysOff',
    'getCommissions', 'getCommissionSummary',
    'getArticles',
    'getCurrentAdmin'
  ]
}

function normalizeAdminRole(role, fallback = 'manager') {
  return ADMIN_ROLE_OPTIONS.includes(role) ? role : fallback
}

function canAdminAccessAction(role, action) {
  const normalizedRole = normalizeAdminRole(role, 'viewer')
  const allowedActions = ADMIN_ACTION_PERMISSIONS[normalizedRole] || []
  return allowedActions.includes('*') || allowedActions.includes(action)
}

function sanitizeAdminUser(user = {}) {
  const safeUser = { ...user }
  delete safeUser.password_hash
  safeUser.role = normalizeAdminRole(safeUser.role, 'super_admin')
  safeUser.status = safeUser.status || 'active'
  return safeUser
}

function getWechatMiniProgramConfig() {
  const appid = process.env.WECHAT_APPID || process.env.WECHAT_APP_ID || process.env.WX_APPID || process.env.WX_APP_ID
  const appSecret = process.env.WECHAT_APPSECRET || process.env.WECHAT_APP_SECRET || process.env.WX_APPSECRET || process.env.WX_APP_SECRET
  return { appid, appSecret }
}

async function requestWechatJson(url, method, data, headers = {}) {
  const hasBody = data && method !== 'GET'
  const body = hasBody ? JSON.stringify(data) : ''
  const requestUrl = new URL(url)
  const timeoutMs = REQUEST_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    let req = null
    const timer = setTimeout(() => {
      if (req) {
        req.destroy()
      }
      reject(new Error(`微信 API 请求超时：${method} ${url}`))
    }, timeoutMs)

    req = https.request(
      {
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(hasBody ? { 'Content-Length': Buffer.from(body).length } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          const responseBody = Buffer.concat(chunks)
          const contentType = (res.headers['content-type'] || '').toLowerCase()

          if (contentType.includes('application/json') || contentType.includes('text/plain')) {
            let payload
            try {
              payload = JSON.parse(responseBody.toString('utf8') || '{}')
            } catch (err) {
              payload = { raw: responseBody.toString('utf8') }
            }
            if (payload && typeof payload.errcode !== 'undefined' && Number(payload.errcode) !== 0) {
              const msg = payload.errmsg ? payload.errmsg : `HTTP ${res.statusCode}`
              reject(new Error(`微信 API 调用失败: ${msg}`))
              return
            }

            if (res.statusCode < 200 || res.statusCode >= 300) {
              const msg = payload && payload.errmsg ? payload.errmsg : `HTTP ${res.statusCode}`
              reject(new Error(`微信 API 调用失败: ${msg}`))
              return
            }
            resolve({ body: payload, headers: res.headers, contentType })
            return
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`微信 API 调用失败: HTTP ${res.statusCode}`))
            return
          }

          resolve({ body: responseBody, headers: res.headers, contentType })
        })
      }
    )

    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    if (hasBody) req.write(body)
    req.end()
  })
}

async function getWechatAccessToken() {
  const now = Date.now()
  if (wechatTokenCache.token && wechatTokenCache.expireAt > now + 60 * 1000) {
    return wechatTokenCache.token
  }

  const { appid, appSecret } = getWechatMiniProgramConfig()
  if (!appid || !appSecret) {
    throw new Error('缺少微信小程序 APPID/APPSECRET 配置，无法生成小程序码')
  }

  const tokenApi = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(appSecret)}`
  const tokenRes = await requestWechatJson(tokenApi, 'GET')

  if (!tokenRes.body || !tokenRes.body.access_token) {
    throw new Error('微信 token 返回异常')
  }

  const expireInSeconds = Number(tokenRes.body.expires_in || 7200)
  wechatTokenCache.token = tokenRes.body.access_token
  wechatTokenCache.expireAt = now + (Math.max(120, expireInSeconds - 120) * 1000)
  return wechatTokenCache.token
}

function getMiniProgramPagePath() {
  const configuredPath = process.env.WECHAT_MINIPROGRAM_LOGIN_PAGE
    || 'pages/scan-confirm/scan-confirm'
  const normalized = (configuredPath || '').replace(/^\//, '')

  if (!normalized || normalized.length > MINI_PROGRAM_PAGE_MAX_LENGTH) {
    return 'pages/scan-confirm/scan-confirm'
  }

  return normalized
}

function normalizeMiniProgramScene(sessionId) {
  if (typeof sessionId !== 'string') return ''
  if (sessionId.length > MINI_PROGRAM_QR_SCENE_MAX_LENGTH) return ''
  return sessionId
}

exports.main = async (event, context) => {
  if (event && event.httpMethod) {
    return handleHttpAccess(event)
  }

  const { action, data, id } = event

  try {
    // 受保护的 action 需要校验管理员会话和角色权限
    const protectedActions = [
      'getServices', 'createService', 'updateService',
      'getTechnicians', 'createTechnician', 'updateTechnician', 'toggleTechnicianStatus',
      'getCustomers', 'updateCustomer', 'deleteCustomer', 'toggleBlacklist',
      'getAppointments', 'getAppointmentDetail',
      'getHolidays', 'addHoliday', 'deleteHoliday',
      'getTechDaysOff', 'addTechDayOff', 'deleteTechDayOff',
      'getCommissions', 'getCommissionSummary',
      'getArticles', 'createArticle', 'updateArticle', 'toggleArticleStatus',
      'updateConfig', 'importHolidays',
      'getCurrentAdmin',
      'getAdminUsers', 'addAdminUser', 'updateAdminUser', 'removeAdminUser', 'createAdminBindSession'
    ]

    if (protectedActions.includes(action)) {
      const adminAuth = await getAdminAuth(event)
      if (!adminAuth) {
        return { code: -1, message: '身份验证失败，请重新登录' }
      }
      if (!canAdminAccessAction(adminAuth.role, action)) {
        return { code: -1, message: '当前账号无权限访问该功能' }
      }
    }

    switch (action) {
      // 获取营业配置
      case 'getConfig':
        return await getConfig(event)

      // 管理员登录
      case 'verifyAdminPassword':
        return await verifyAdminPassword(data)

      // 更新营业配置
      case 'updateConfig':
        return await updateConfig(data)

      // 服务管理
      case 'getServices':
        return await getServices()
      case 'createService':
        return await createService(data)
      case 'updateService':
        return await updateService(data)

      // 技师管理
      case 'getTechnicians':
        return await getTechnicians()
      case 'createTechnician':
        return await createTechnician(data)
      case 'updateTechnician':
        return await updateTechnician(data)
      case 'toggleTechnicianStatus':
        return await toggleTechnicianStatus(data)

      // 客户管理
      case 'getCustomers':
        return await getCustomers(data)
      case 'updateCustomer':
        return await updateCustomer(data)
      case 'deleteCustomer':
        return await deleteCustomer(data)
      case 'toggleBlacklist':
        return await toggleBlacklist(data)

      // 预约管理
      case 'getAppointments':
        return await getAdminAppointments(data)
      case 'getAppointmentDetail':
        return await getAppointmentDetail(data)

      // 休息管理
      case 'getHolidays':
        return await getHolidays(data)
      case 'addHoliday':
        return await addHoliday(data)
      case 'deleteHoliday':
        return await deleteHoliday(data)
      case 'getTechDaysOff':
        return await getTechDaysOff()
      case 'addTechDayOff':
        return await addTechDayOff(data)
      case 'deleteTechDayOff':
        return await deleteTechDayOff(data)

      // 提成统计
      case 'getCommissions':
        return await getCommissions(data)
      case 'getCommissionSummary':
        return await getCommissionSummary(data)

      // 文章管理
      case 'getArticles':
        return await getArticles()
      case 'createArticle':
        return await createArticle(data)
      case 'updateArticle':
        return await updateArticle(data)
      case 'toggleArticleStatus':
        return await toggleArticleStatus(data)

      // 导入法定节假日
      case 'importHolidays':
        return await importHolidays()

      // 管理员账号管理
      case 'getCurrentAdmin':
        return await getCurrentAdmin(event)
      case 'getAdminUsers':
        return await getAdminUsers()
      case 'addAdminUser':
        return await addAdminUser(data)
      case 'updateAdminUser':
        return await updateAdminUser(data)
      case 'removeAdminUser':
        return await removeAdminUser(data)

      // 扫码登录
      case 'createSession':
        return await createLoginSession(data)
      case 'createLoginSession':
        return await createLoginSession(data)
      case 'createAdminBindSession':
        return await createAdminBindSession(data)
      case 'confirmLoginSession':
        return await confirmLoginSession(data)
      case 'checkLoginSession':
        return await checkLoginSession(data)
      case 'scanLogin':
        return await scanLogin(data)

      default:
        return { code: -1, message: '未知操作' }
    }
  } catch (err) {
    console.error(`操作 ${action} 失败:`, err)
    return { code: -1, message: err.message || '操作失败' }
  }
}

function handleHttpAccess(event) {
  const query = event.queryStringParameters || {}
  const sessionId = query.session_id || ''

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message: 'Method Not Allowed' })
    }
  }

  if (!sessionId || !/^[a-z0-9]{32}$/.test(sessionId)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<!doctype html><html><head><meta charset="utf-8"><title>扫码登录</title></head><body><p>无效的登录二维码，请返回管理后台刷新后重试。</p></body></html>'
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>扫码登录</title></head><body><p>请使用微信扫描该二维码，并在小程序内确认登录。</p></body></html>'
  }
}

function generateToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('hex')
}

function hashAdminPassword(password) {
  return crypto
    .createHash('sha256')
    .update(`${ADMIN_PASSWORD_SALT}:${String(password || '')}`)
    .digest('hex')
}

async function createAdminSession(data = {}) {
  const token = generateToken()
  const now = Date.now()
  const role = normalizeAdminRole(data.role, 'super_admin')

  await db.collection('admin_sessions').add({
    data: {
      _id: token,
      admin_user_id: data.admin_user_id || '',
      username: data.username || '',
      role,
      openid: data.openid || '',
      login_method: data.login_method || 'password',
      created_at: now,
      expires_at: now + 24 * 60 * 60 * 1000
    }
  })

  return token
}

async function getAdminAuth(event = {}) {
  if (!event.admin_token) {
    return null
  }

  try {
    const session = await db.collection('admin_sessions').doc(event.admin_token).get()
    if (!session.data || Date.now() > session.data.expires_at) {
      return null
    }

    let role = normalizeAdminRole(session.data.role, 'super_admin')
    let username = session.data.username || ''
    const adminUserId = session.data.admin_user_id || ''

    if (adminUserId) {
      const adminUserRes = await db.collection('admin_users').doc(adminUserId).get()
      if (!adminUserRes.data || (adminUserRes.data.status && adminUserRes.data.status !== 'active')) {
        return null
      }
      role = normalizeAdminRole(adminUserRes.data.role, 'super_admin')
      username = adminUserRes.data.username || username
    }

    return {
      token: event.admin_token,
      admin_user_id: adminUserId,
      username,
      role,
      openid: session.data.openid || ''
    }
  } catch (err) {
    return null
  }
}

async function validateAdminAuth(event = {}) {
  return Boolean(await getAdminAuth(event))
}

// ==================== 营业配置 ====================

async function getConfig(event = {}) {
  const res = await db.collection('business_config').limit(1).get()
  if (res.data.length === 0) {
    // 创建默认配置
    const defaultConfig = {
      store: {
        name: 'XX中医门诊',
        phone: '010-12345678',
        address: 'XX市XX区XX路XX号',
        latitude: 39.9042,
        longitude: 116.4074
      },
      schedule: {
        1: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        2: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        3: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        4: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        5: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        6: [{ start: '09:00', end: '12:00' }],
        7: []
      },
      slot_interval: 30,
      holidays: [],
      max_advance_days: 14
    }

    await db.collection('business_config').add({ data: defaultConfig })
    return { code: 0, data: sanitizeConfig(defaultConfig, await validateAdminAuth(event)) }
  }

  return { code: 0, data: sanitizeConfig(res.data[0], await validateAdminAuth(event)) }
}

function sanitizeConfig(config, isAdmin) {
  if (isAdmin) {
    return config
  }

  const { admin_password, ...publicConfig } = config
  return publicConfig
}

async function verifyAdminPassword(data) {
  if (!data || !data.password || !data.username) {
    return { code: -1, message: '请输入账号和密码' }
  }

  const username = (data.username || '').trim()
  const accountRes = await db.collection('admin_users').where({ username }).limit(1).get()
  if (accountRes.data.length === 0) {
    const bootstrapResult = await tryBootstrapFirstAdmin(username, data.password)
    if (bootstrapResult) {
      return bootstrapResult
    }

    return { code: -1, message: '账号或密码错误' }
  }

  const account = accountRes.data[0]
  if (account.status && account.status !== 'active') {
    return { code: -1, message: '账号已停用，请联系管理员' }
  }

  if (account.password_hash !== hashAdminPassword(data.password)) {
    return { code: -1, message: '账号或密码错误' }
  }

  const role = normalizeAdminRole(account.role, 'super_admin')
  const token = await createAdminSession({
    admin_user_id: account._id,
    username: account.username,
    role,
    login_method: 'password',
    openid: account.openid || ''
  })
  return { code: 0, data: { token, username: account.username, role } }
}

async function tryBootstrapFirstAdmin(username, password) {
  if (!ADMIN_BOOTSTRAP_USERNAME || !ADMIN_BOOTSTRAP_PASSWORD) {
    return null
  }

  if (username !== ADMIN_BOOTSTRAP_USERNAME || String(password || '') !== ADMIN_BOOTSTRAP_PASSWORD) {
    return null
  }

  const existingAdminRes = await db.collection('admin_users').limit(1).get()
  if (existingAdminRes.data.length > 0) {
    return null
  }

  const addRes = await db.collection('admin_users').add({
    data: {
      username,
      password_hash: hashAdminPassword(password),
      openid: '',
      role: 'super_admin',
      name: '系统管理员',
      remark: '首次登录自动创建',
      status: 'active',
      created_at: db.serverDate()
    }
  })

  const token = await createAdminSession({
    admin_user_id: addRes._id,
    username,
    role: 'super_admin',
    login_method: 'password'
  })
  return { code: 0, data: { token, username, role: 'super_admin', bootstrapped: true } }
}

async function updateConfig(data) {
  const res = await db.collection('business_config').limit(1).get()

  if (res.data.length === 0) {
    await db.collection('business_config').add({ data })
  } else {
    await db.collection('business_config')
      .doc(res.data[0]._id)
      .update({ data })
  }

  return { code: 0, data: { message: '更新成功' } }
}

// ==================== 服务管理 ====================

async function getServices() {
  const res = await db.collection('services')
    .where({ status: _.neq('deleted') })
    .orderBy('sort_order', 'asc')
    .get()

  // 转换 cloud:// 图片链接为 https 临时链接
  const cloudIds = res.data
    .map(s => s.image_url || s.imageUrl)
    .filter(u => u && u.startsWith('cloud://'))

  if (cloudIds.length > 0) {
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: cloudIds })
      const urlMap = {}
      urlRes.fileList.forEach(f => { urlMap[f.fileID] = f.tempFileURL })
      res.data.forEach(s => {
        const key = s.image_url || s.imageUrl
        if (key && urlMap[key]) {
          s.image_url = urlMap[key]
        }
      })
    } catch (e) {
      console.error('转换图片链接失败:', e.message)
    }
  }

  return { code: 0, data: res.data }
}

async function createService(data) {
  const res = await db.collection('services').add({
    data: {
      ...data,
      status: 'active',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function updateService(data) {
  const { id, ...updateData } = data
  if (!id) {
    return { code: -1, message: '缺少必要参数: id' }
  }

  // 统一图片字段为 image_url
  if (updateData.imageUrl !== undefined) {
    updateData.image_url = updateData.imageUrl
    delete updateData.imageUrl
  }

  await db.collection('services')
    .doc(id)
    .update({
      data: {
        ...updateData,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '更新成功' } }
}

// ==================== 技师管理 ====================

async function getTechnicians() {
  const res = await db.collection('technicians')
    .where({ status: _.neq('deleted') })
    .orderBy('created_at', 'desc')
    .get()

  return { code: 0, data: res.data }
}

async function createTechnician(data) {
  // 检查手机号是否已存在
  const existing = await db.collection('technicians')
    .where({ phone: data.phone })
    .get()

  if (existing.data.length > 0) {
    return { code: -1, message: '该手机号已被注册' }
  }

  const res = await db.collection('technicians').add({
    data: {
      ...data,
      openid: '',
      custom_commissions: {},
      status: 'active',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function updateTechnician(data) {
  const { id, ...updateData } = data
  if (!id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('technicians')
    .doc(id)
    .update({
      data: {
        ...updateData,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '更新成功' } }
}

// ==================== 客户管理 ====================

async function getCustomers(params) {
  const page = (params && params.page) || 1
  const pageSize = (params && params.page_size) || 20

  let conditions = null
  if (params && params.keyword) {
    conditions = _.or([
      { nick_name: db.RegExp({ regexp: params.keyword, options: 'i' }) },
      { phone: db.RegExp({ regexp: params.keyword, options: 'i' }) }
    ])
  }

  let countQuery = db.collection('users')
  let dataQuery = db.collection('users')

  if (conditions) {
    countQuery = countQuery.where(conditions)
    dataQuery = dataQuery.where(conditions)
  }

  const countRes = await countQuery.count()
  const total = countRes.total

  const res = await dataQuery
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  return { code: 0, data: { list: res.data, total } }
}

async function updateCustomer(data) {
  const { id, ...updateData } = data
  if (!id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('users')
    .doc(id)
    .update({
      data: {
        ...updateData,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '更新成功' } }
}

async function deleteCustomer(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('users')
    .doc(data.id)
    .remove()

  return { code: 0, data: { message: '删除成功' } }
}

// ==================== 预约管理 ====================

async function getAdminAppointments(params) {
  const page = (params && params.page) || 1
  const pageSize = (params && params.page_size) || 20

  let conditions = {}
  if (params) {
    if (params.status) {
      conditions.status = params.status
    }
    if (params.technician_id) {
      conditions.technician_id = params.technician_id
    }
    if (params.start_date && params.end_date) {
      conditions.date = _.gte(params.start_date).and(_.lte(params.end_date))
    } else if (params.date) {
      conditions.date = params.date
    }
  }

  let countQuery = db.collection('appointments')
  let dataQuery = db.collection('appointments')

  if (Object.keys(conditions).length > 0) {
    countQuery = countQuery.where(conditions)
    dataQuery = dataQuery.where(conditions)
  }

  const countRes = await countQuery.count()
  const total = countRes.total

  const res = await dataQuery
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // 过滤掉 _init 文档
  const realAppointments = res.data.filter(a => !a._init)

  // 获取关联数据
  const appointments = await Promise.all(realAppointments.map(async (apt) => {
    // 获取服务名称
    let serviceNames = ''
    if (apt.services && apt.services.length > 0) {
      const servicesRes = await db.collection('services')
        .where({ _id: _.in(apt.services) })
        .get()
      serviceNames = servicesRes.data.map(s => s.name).join('、')
    }

    // 获取技师名称
    let technicianName = ''
    if (apt.technician_id) {
      try {
        const techRes = await db.collection('technicians')
          .doc(apt.technician_id)
          .get()
        if (techRes.data) {
          technicianName = techRes.data.name
        }
      } catch (e) {
        console.error('获取技师信息失败:', e.message)
      }
    }

    // 获取患者信息
    let patientName = '未知用户'
    if (apt.patient_openid) {
      try {
        const userRes = await db.collection('users')
          .where({ openid: apt.patient_openid })
          .get()
        if (userRes.data.length > 0) {
          patientName = userRes.data[0].nick_name || '未知用户'
        }
      } catch (e) {
        console.error('获取用户信息失败:', e.message)
      }
    }

    return {
      ...apt,
      service_names: serviceNames,
      technician_name: technicianName,
      patient_name: patientName
    }
  }))

  return { code: 0, data: { list: appointments, total } }
}

// ==================== 休息管理 ====================

async function getHolidays(params) {
  let query = db.collection('holidays')

  if (params && params.type) {
    query = query.where({ type: params.type })
  }

  const res = await query
    .orderBy('date', 'asc')
    .get()

  return { code: 0, data: res.data }
}

async function addHoliday(data) {
  // 检查是否已存在
  const existing = await db.collection('holidays')
    .where({ date: data.date, type: data.type })
    .get()

  if (existing.data.length > 0) {
    return { code: -1, message: '该日期已存在' }
  }

  const res = await db.collection('holidays').add({
    data: {
      ...data,
      created_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function deleteHoliday(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('holidays').doc(data.id).remove()
  return { code: 0, data: { message: '删除成功' } }
}

async function getTechDaysOff() {
  const res = await db.collection('tech_days_off')
    .orderBy('date', 'desc')
    .get()

  // 获取技师名称
  const daysOff = await Promise.all(res.data.map(async (item) => {
    let technicianName = ''
    if (item.technician_id) {
      try {
        const techRes = await db.collection('technicians')
          .doc(item.technician_id)
          .get()
        if (techRes.data) {
          technicianName = techRes.data.name
        }
      } catch (e) {
        console.error('获取技师信息失败:', e.message)
      }
    }
    return { ...item, technician_name: technicianName }
  }))

  return { code: 0, data: daysOff }
}

async function addTechDayOff(data) {
  // 检查是否已存在
  const existing = await db.collection('tech_days_off')
    .where({
      technician_id: data.technician_id,
      date: data.date
    })
    .get()

  if (existing.data.length > 0) {
    return { code: -1, message: '该技师当天已有休假记录' }
  }

  const res = await db.collection('tech_days_off').add({
    data: {
      ...data,
      created_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function deleteTechDayOff(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('tech_days_off').doc(data.id).remove()
  return { code: 0, data: { message: '删除成功' } }
}

// ==================== 提成统计 ====================

async function getCommissions(params) {
  const page = (params && params.page) || 1
  const pageSize = (params && params.page_size) || 20

  let conditions = {}
  if (params) {
    if (params.technician_id) {
      conditions.technician_id = params.technician_id
    }
    if (params.start_date && params.end_date) {
      conditions.date = _.gte(params.start_date).and(_.lte(params.end_date))
    }
  }

  let countQuery = db.collection('commission_records')
  let dataQuery = db.collection('commission_records')

  if (Object.keys(conditions).length > 0) {
    countQuery = countQuery.where(conditions)
    dataQuery = dataQuery.where(conditions)
  }

  const countRes = await countQuery.count()
  const total = countRes.total

  const res = await dataQuery
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  return { code: 0, data: { list: res.data, total } }
}

async function getCommissionSummary(params) {
  let conditions = {}
  if (params) {
    if (params.technician_id) {
      conditions.technician_id = params.technician_id
    }
    if (params.start_date && params.end_date) {
      conditions.date = _.gte(params.start_date).and(_.lte(params.end_date))
    }
  }

  let query = db.collection('commission_records')
  if (Object.keys(conditions).length > 0) {
    query = query.where(conditions)
  }

  const res = await query.get()

  const total = res.data.reduce((sum, item) => sum + (item.commission_amount || 0), 0)
  const count = res.data.length

  return { code: 0, data: { total, count } }
}

// ==================== 文章管理 ====================

async function getArticles() {
  const res = await db.collection('articles')
    .where({ status: _.neq('deleted') })
    .orderBy('sort_order', 'asc')
    .get()

  return { code: 0, data: res.data }
}

async function createArticle(data) {
  const res = await db.collection('articles').add({
    data: {
      ...data,
      status: data.status || 'draft',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function updateArticle(data) {
  const { id, ...updateData } = data
  if (!id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('articles')
    .doc(id)
    .update({
      data: {
        ...updateData,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '更新成功' } }
}

async function toggleArticleStatus(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('articles')
    .doc(data.id)
    .update({
      data: {
        status: data.status,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '状态更新成功' } }
}

// ==================== 新增功能 ====================

async function getAppointmentDetail(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  const res = await db.collection('appointments').doc(data.id).get()
  const apt = res.data

  // 获取服务名称
  let serviceNames = ''
  if (apt.services && apt.services.length > 0) {
    const servicesRes = await db.collection('services')
      .where({ _id: _.in(apt.services) })
      .get()
    serviceNames = servicesRes.data.map(s => s.name).join('、')
  }

  // 获取技师名称
  let technicianName = ''
  if (apt.technician_id) {
    try {
      const techRes = await db.collection('technicians').doc(apt.technician_id).get()
      if (techRes.data) technicianName = techRes.data.name
    } catch (e) {
      console.error('获取技师信息失败:', e.message)
    }
  }

  // 获取患者信息
  let patientName = '未知用户'
  let patientPhone = ''
  if (apt.patient_openid) {
    try {
      const userRes = await db.collection('users')
        .where({ openid: apt.patient_openid })
        .get()
      if (userRes.data.length > 0) {
        patientName = userRes.data[0].nick_name || '未知用户'
        patientPhone = userRes.data[0].phone || ''
      }
    } catch (e) {
      console.error('获取用户信息失败:', e.message)
    }
  }

  return {
    code: 0,
    data: {
      ...apt,
      service_names: serviceNames,
      technician_name: technicianName,
      patient_name: patientName,
      patient_phone: patientPhone
    }
  }
}

async function toggleBlacklist(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('users')
    .doc(data.id)
    .update({
      data: {
        is_blacklisted: data.is_blacklisted,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: data.is_blacklisted ? '已加入黑名单' : '已取消黑名单' } }
}

async function toggleTechnicianStatus(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('technicians')
    .doc(data.id)
    .update({
      data: {
        status: data.status,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '状态更新成功' } }
}

// ==================== 导入法定节假日 ====================

async function importHolidays() {
  // 2026年中国法定节假日
  const holidays = [
    { date: '2026-01-01', reason: '元旦' },
    { date: '2026-02-15', reason: '春节' },
    { date: '2026-02-16', reason: '春节' },
    { date: '2026-02-17', reason: '春节' },
    { date: '2026-02-18', reason: '春节' },
    { date: '2026-02-19', reason: '春节' },
    { date: '2026-02-20', reason: '春节' },
    { date: '2026-02-21', reason: '春节' },
    { date: '2026-04-04', reason: '清明节' },
    { date: '2026-04-05', reason: '清明节' },
    { date: '2026-04-06', reason: '清明节' },
    { date: '2026-05-01', reason: '劳动节' },
    { date: '2026-05-02', reason: '劳动节' },
    { date: '2026-05-03', reason: '劳动节' },
    { date: '2026-05-04', reason: '劳动节' },
    { date: '2026-05-05', reason: '劳动节' },
    { date: '2026-06-19', reason: '端午节' },
    { date: '2026-06-20', reason: '端午节' },
    { date: '2026-06-21', reason: '端午节' },
    { date: '2026-10-01', reason: '国庆节' },
    { date: '2026-10-02', reason: '国庆节' },
    { date: '2026-10-03', reason: '国庆节' },
    { date: '2026-10-04', reason: '中秋节' },
    { date: '2026-10-05', reason: '国庆节' },
    { date: '2026-10-06', reason: '国庆节' },
    { date: '2026-10-07', reason: '国庆节' },
  ]

  let added = 0
  let skipped = 0

  for (const h of holidays) {
    const existing = await db.collection('holidays')
      .where({ date: h.date, type: 'closure' })
      .get()

    if (existing.data.length > 0) {
      skipped++
      continue
    }

    await db.collection('holidays').add({
      data: {
        date: h.date,
        type: 'closure',
        reason: h.reason,
        created_at: db.serverDate()
      }
    })
    added++
  }

  return {
    code: 0,
    data: { message: `导入完成：新增 ${added} 天，跳过 ${skipped} 天已存在记录` }
  }
}

// ==================== 扫码登录 ====================

function generateSessionId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 32; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}

async function createLoginSession(data = {}) {
  const sessionId = normalizeMiniProgramScene(generateSessionId())
  if (!sessionId) {
    return { code: -1, message: '会话创建失败' }
  }

  const now = Date.now()

  await db.collection('login_sessions').add({
    data: {
      _id: sessionId,
      status: 'pending',
      type: 'admin_login',
      openid: '',
      created_at: now,
      expires_at: now + 5 * 60 * 1000 // 5 分钟过期
    }
  })

  const qrCodeBase64 = await createMiniProgramLoginQrCode(sessionId)
  if (!qrCodeBase64) {
    await db.collection('login_sessions').doc(sessionId).update({
      data: {
        status: 'expired',
        reject_reason: '小程序码生成失败'
      }
    })
    return { code: -1, message: '小程序码生成失败，请检查微信 AppSecret 或云调用权限配置' }
  }

  return {
    code: 0,
    data: {
      session_id: sessionId,
      expires_at: now + 5 * 60 * 1000,
      qr_code_base64: qrCodeBase64,
      qr_code_type: 'miniprogram'
    }
  }
}

async function createAdminBindSession(data = {}) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少管理员账号 id' }
  }

  const adminRes = await db.collection('admin_users').doc(data.id).get()
  if (!adminRes.data) {
    return { code: -1, message: '管理员账号不存在' }
  }

  const sessionId = normalizeMiniProgramScene(generateSessionId())
  if (!sessionId) {
    return { code: -1, message: '会话创建失败' }
  }

  const now = Date.now()
  await db.collection('login_sessions').add({
    data: {
      _id: sessionId,
      status: 'pending',
      type: 'admin_bind',
      admin_user_id: data.id,
      admin_username: adminRes.data.username || '',
      openid: '',
      created_at: now,
      expires_at: now + 5 * 60 * 1000
    }
  })

  const qrCodeBase64 = await createMiniProgramLoginQrCode(sessionId)
  if (!qrCodeBase64) {
    await db.collection('login_sessions').doc(sessionId).update({
      data: {
        status: 'expired',
        reject_reason: '小程序码生成失败'
      }
    })
    return { code: -1, message: '小程序码生成失败，请检查微信 AppSecret 或云调用权限配置' }
  }

  return {
    code: 0,
    data: {
      session_id: sessionId,
      expires_at: now + 5 * 60 * 1000,
      qr_code_base64: qrCodeBase64,
      qr_code_type: 'miniprogram',
      username: adminRes.data.username || ''
    }
  }
}

async function createMiniProgramLoginQrCode(sessionId) {
  const pagePath = getMiniProgramPagePath()
  const scene = normalizeMiniProgramScene(sessionId)

  if (!scene) {
    console.error('小程序码场景参数不合法：', sessionId)
    return ''
  }

  try {
    const accessToken = await getWechatAccessToken()
    const codeUrl = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`
    const result = await requestWechatJson(codeUrl, 'POST', {
      scene,
      page: pagePath,
      check_path: false,
      env_version: WECHAT_MINIPROGRAM_QR_ENV_VERSION,
      width: 280
    })

    if (!result || !result.body || !result.body.length) {
      throw new Error('小程序码返回为空')
    }

    if ((result.contentType || '').includes('json')) {
      const payload = result.body || {}
      const errCode = payload.errcode
      if (errCode) {
        throw new Error(payload.errmsg || `errcode=${errCode}`)
      }
    }

    return result.body.toString('base64')
  } catch (err) {
    console.error('生成微信小程序码失败:', err)

    try {
      const fallback = await cloud.openapi.wxacode.getUnlimited({
        scene,
        page: pagePath,
        checkPath: false,
        width: 280
      })

      if (!fallback || !fallback.buffer) {
        return ''
      }

      return fallback.buffer.toString('base64')
    } catch (fallbackErr) {
      console.error('OpenAPI fallback 失败:', fallbackErr)
      return ''
    }
  }
}

async function confirmLoginSession(data) {
  if (!data || !data.session_id) {
    return { code: -1, message: '缺少 session_id' }
  }

  const markRejected = async (reason, status = 'rejected') => {
    try {
      await db.collection('login_sessions').doc(data.session_id).update({
        data: {
          status,
          reject_reason: reason,
          rejected_at: Date.now()
        }
      })
    } catch (err) {
      console.error('标记扫码会话状态失败:', err)
    }
  }

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    await markRejected('无法获取微信身份')
    return { code: -1, message: '无法获取用户身份' }
  }

  try {
    const session = await db.collection('login_sessions').doc(data.session_id).get()

    if (!session.data) {
      await markRejected('会话不存在')
      return { code: -1, message: '登录会话不存在' }
    }

    if (session.data.status !== 'pending') {
      await markRejected('会话已使用或过期', session.data.status || 'rejected')
      return { code: -1, message: '该登录会话已使用或过期' }
    }

    if (Date.now() > session.data.expires_at) {
      await markRejected('登录会话已过期')
      await db.collection('login_sessions').doc(data.session_id).update({
        data: { status: 'expired' }
      })
      return { code: -1, message: '登录会话已过期' }
    }

    if (session.data.type === 'admin_bind') {
      return await confirmAdminBindSession(data.session_id, session.data, openid, markRejected)
    }

    return await confirmAdminLoginSession(data.session_id, openid, markRejected)
  } catch (err) {
    await markRejected('确认失败：' + err.message)
    return { code: -1, message: '确认失败：' + err.message }
  }
}

async function confirmAdminLoginSession(sessionId, openid, markRejected) {
  try {
    const adminUser = await db.collection('admin_users').where({ openid, status: 'active' }).get()
    if (adminUser.data.length === 0) {
      await markRejected('该微信用户未绑定或账号已停用')
      return { code: -1, message: '无权限访问管理后台，请先在管理员账号中绑定微信' }
    }
  } catch (err) {
    await markRejected('未查询到管理员绑定配置')
    return { code: -1, message: '无权限访问管理后台，请先在管理员账号中绑定微信' }
  }

  await db.collection('login_sessions').doc(sessionId).update({
    data: {
      status: 'confirmed',
      type: 'admin_login',
      openid,
      confirmed_at: Date.now()
    }
  })

  return { code: 0, data: { message: '确认登录成功', type: 'admin_login' } }
}

async function confirmAdminBindSession(sessionId, session, openid, markRejected) {
  if (!session.admin_user_id) {
    await markRejected('绑定会话缺少管理员账号')
    return { code: -1, message: '绑定会话异常，请重新生成二维码' }
  }

  const targetRes = await db.collection('admin_users').doc(session.admin_user_id).get()
  if (!targetRes.data) {
    await markRejected('管理员账号不存在')
    return { code: -1, message: '管理员账号不存在' }
  }

  if (targetRes.data.status && targetRes.data.status !== 'active') {
    await markRejected('管理员账号已停用')
    return { code: -1, message: '管理员账号已停用，不能绑定微信' }
  }

  const existing = await db.collection('admin_users')
    .where({
      openid,
      _id: _.neq(session.admin_user_id)
    })
    .get()

  if (existing.data.length > 0) {
    await markRejected('该微信已绑定其他管理员账号')
    return { code: -1, message: '该微信已绑定其他管理员账号，请先解绑后重试' }
  }

  await db.collection('admin_users').doc(session.admin_user_id).update({
    data: {
      openid,
      bound_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  await db.collection('login_sessions').doc(sessionId).update({
    data: {
      status: 'confirmed',
      type: 'admin_bind',
      openid,
      confirmed_at: Date.now()
    }
  })

  return { code: 0, data: { message: '微信绑定成功', type: 'admin_bind' } }
}

async function checkLoginSession(data) {
  if (!data || !data.session_id) {
    return { code: -1, message: '缺少 session_id' }
  }

  try {
    const session = await db.collection('login_sessions').doc(data.session_id).get()

    if (!session.data) {
      return { code: -1, message: '会话不存在' }
    }

    if (Date.now() > session.data.expires_at && session.data.status !== 'logged_in') {
      await db.collection('login_sessions').doc(data.session_id).update({
        data: { status: 'expired' }
      })
      return { code: 0, data: { status: 'expired' } }
    }

    return {
      code: 0,
      data: {
        status: session.data.status,
        type: session.data.type || 'admin_login',
        admin_username: session.data.admin_username || '',
        reason: session.data.reject_reason || '',
        reject_reason: session.data.reject_reason || ''
      }
    }
  } catch (err) {
    return { code: -1, message: '查询失败：' + err.message }
  }
}

async function scanLogin(data) {
  if (!data || !data.session_id) {
    return { code: -1, message: '缺少 session_id' }
  }

  try {
    const session = await db.collection('login_sessions').doc(data.session_id).get()

    if (!session.data) {
      return { code: -1, message: '会话不存在' }
    }

    if (session.data.status === 'rejected') {
      return { code: -1, message: '会话已被拒绝' }
    }

    if (session.data.type && session.data.type !== 'admin_login') {
      return { code: -1, message: '该二维码不是登录二维码，请刷新后重试' }
    }

    if (session.data.status !== 'confirmed') {
      return { code: -1, message: '会话未确认或已过期' }
    }

    if (Date.now() > session.data.expires_at) {
      await db.collection('login_sessions').doc(data.session_id).update({
        data: { status: 'expired' }
      })
      return { code: -1, message: '会话已过期' }
    }

    const adminRes = await db.collection('admin_users')
      .where({ openid: session.data.openid })
      .limit(1)
      .get()

    if (adminRes.data.length === 0) {
      return { code: -1, message: '该微信未绑定管理员账号' }
    }

    const adminUser = adminRes.data[0]
    if (adminUser.status && adminUser.status !== 'active') {
      return { code: -1, message: '管理员账号已停用' }
    }

    const role = normalizeAdminRole(adminUser.role, 'super_admin')
    const token = await createAdminSession({
      admin_user_id: adminUser._id,
      username: adminUser.username || '',
      role,
      openid: adminUser.openid || session.data.openid,
      login_method: 'scan'
    })

    await db.collection('login_sessions').doc(data.session_id).update({
      data: {
        status: 'logged_in',
        admin_token: token,
        logged_in_at: Date.now()
      }
    })

    return { code: 0, data: { token, username: adminUser.username || '', role } }
  } catch (err) {
    return { code: -1, message: '登录失败：' + err.message }
  }
}

// ==================== 管理员账号管理 ====================

async function getCurrentAdmin(event = {}) {
  const adminAuth = await getAdminAuth(event)
  if (!adminAuth) {
    return { code: -1, message: '身份验证失败，请重新登录' }
  }

  return {
    code: 0,
    data: {
      username: adminAuth.username || '管理员',
      role: adminAuth.role,
      openid: adminAuth.openid || ''
    }
  }
}

async function getAdminUsers() {
  const res = await db.collection('admin_users')
    .orderBy('created_at', 'desc')
    .get()
  return { code: 0, data: res.data.map(sanitizeAdminUser) }
}

async function addAdminUser(data) {
  const username = (data && data.username || '').trim()
  const password = (data && data.password || '').trim()
  const role = normalizeAdminRole(data && typeof data.role === 'string' ? data.role : 'manager', '')

  if (!username) {
    return { code: -1, message: '请输入登录账号' }
  }
  if (!password) {
    return { code: -1, message: '请输入登录密码' }
  }
  if (!role) {
    return { code: -1, message: '管理员角色无效' }
  }

  const existing = await db.collection('admin_users').where({ username }).get()
  if (existing.data.length > 0) {
    return { code: -1, message: '账号名称已存在' }
  }

  const openid = (data.openid || '').trim()
  if (openid) {
    const existingOpenid = await db.collection('admin_users').where({ openid }).get()
    if (existingOpenid.data.length > 0) {
      return { code: -1, message: '该微信已绑定其他管理员账号' }
    }
  }

  await db.collection('admin_users').add({
    data: {
      username,
      password_hash: hashAdminPassword(password),
      openid,
      role,
      name: data.name || '',
      remark: data.remark || '',
      status: 'active',
      created_at: db.serverDate()
    }
  })

  return { code: 0, data: { message: '添加成功' } }
}

async function updateAdminUser(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少 id' }
  }

  const updateData = {}

  if (typeof data.username === 'string') {
    const username = data.username.trim()
    if (!username) {
      return { code: -1, message: '登录账号不能为空' }
    }

    const existing = await db.collection('admin_users')
      .where({
        username,
        _id: _.neq(data.id)
      }).get()
    if (existing.data.length > 0) {
      return { code: -1, message: '账号名称已存在' }
    }

    updateData.username = username
  }

  if (typeof data.password === 'string' && data.password.trim()) {
    updateData.password_hash = hashAdminPassword(data.password)
  }

  if (typeof data.role === 'string') {
    const role = normalizeAdminRole(data.role, '')
    if (!role) {
      return { code: -1, message: '管理员角色无效' }
    }
    updateData.role = role
  }

  if (typeof data.openid === 'string') {
    const openid = data.openid.trim()
    if (openid) {
      const existingOpenid = await db.collection('admin_users')
        .where({
          openid,
          _id: _.neq(data.id)
        })
        .get()
      if (existingOpenid.data.length > 0) {
        return { code: -1, message: '该微信已绑定其他管理员账号' }
      }
    }
    updateData.openid = openid
  }
  if (typeof data.name === 'string') {
    updateData.name = data.name.trim()
  }
  if (typeof data.remark === 'string') {
    updateData.remark = data.remark.trim()
  }
  if (typeof data.status === 'string' && ['active', 'inactive'].includes(data.status)) {
    updateData.status = data.status
  }

  if (Object.keys(updateData).length === 0) {
    return { code: 0, data: { message: '未修改任何字段' } }
  }

  updateData.updated_at = db.serverDate()
  await db.collection('admin_users').doc(data.id).update({ data: updateData })

  return { code: 0, data: { message: '更新成功' } }
}

async function removeAdminUser(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少 id' }
  }

  await db.collection('admin_users').doc(data.id).remove()
  return { code: 0, data: { message: '删除成功' } }
}
