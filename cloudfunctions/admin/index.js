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
const LOGIN_SESSION_TTL_MS = 5 * 60 * 1000
const ADMIN_PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || 'yxt-admin-salt'
const ADMIN_BOOTSTRAP_USERNAME = process.env.ADMIN_BOOTSTRAP_USERNAME || ''
const ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || ''
const WECHAT_MINIPROGRAM_QR_ENV_VERSION = process.env.WECHAT_MINIPROGRAM_QR_ENV_VERSION || 'release'
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_TENANT_SCOPE = 'single_store'
const ADMIN_ROLE_OPTIONS = ['super_admin', 'manager', 'viewer']
const ADMIN_AUDIT_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const ADMIN_AUDIT_LOG_KEEP_LIMIT = 8000
const DEFAULT_HOME_CARDS = [
  { key: 'business_status', title: '门诊营业状态', enabled: true, sort: 1 },
  { key: 'recommended_technicians', title: '优秀技师', enabled: true, sort: 2 },
  { key: 'wellness_classroom', title: '养生小课堂', enabled: true, sort: 3 }
]
const DEFAULT_FACILITIES = [
  { name: '门口停车', icon: 'logistics', enabled: true, sort: 1 },
  { name: '等候座椅', icon: 'friends-o', enabled: true, sort: 2 },
  { name: '可拨门店', icon: 'phone-o', enabled: true, sort: 3 }
]
const DEFAULT_RECOMMENDED_TECHNICIANS = [
  { name: '李技师', specialty: '擅长颈肩调理', enabled: true, sort: 1 },
  { name: '王技师', specialty: '擅长脾胃养护', enabled: true, sort: 2 }
]
let CURRENT_TRACE_ID = ''
const ADMIN_ACTION_PERMISSIONS = {
  super_admin: ['*'],
  manager: [
    'getServices', 'createService', 'updateService',
    'getTechnicians', 'createTechnician', 'updateTechnician', 'toggleTechnicianStatus', 'deleteTechnician',
    'getCustomers', 'updateCustomer', 'deleteCustomer', 'toggleBlacklist',
    'getAppointments', 'getAppointmentDetail',
    'getHolidays', 'addHoliday', 'deleteHoliday',
    'getTechDaysOff', 'addTechDayOff', 'deleteTechDayOff',
    'getCommissions', 'getCommissionSummary',
    'getArticles', 'createArticle', 'updateArticle', 'toggleArticleStatus', 'deleteArticle',
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

function isRoleValid(role) {
  return ADMIN_ROLE_OPTIONS.includes(role)
}

function getRolePermissions(role) {
  const normalizedRole = isRoleValid(role) ? role : ''
  return ADMIN_ACTION_PERMISSIONS[normalizedRole] || []
}

function normalizeAdminRole(role, fallback = '') {
  return isRoleValid(role) ? role : fallback
}

function parseIntLike(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

function parseDateLike(value) {
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === 'number') {
    return value
  }
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizePagination(value, fallback = 1, max = 200) {
  const n = parseIntLike(value, fallback)
  if (n < 1) return fallback
  if (n > max) return max
  return n
}

function normalizeTraceId(traceId = '') {
  if (typeof traceId !== 'string') {
    return ''
  }

  return traceId.trim().slice(0, 64)
}

function withTraceId(value, traceId = CURRENT_TRACE_ID) {
  const finalTraceId = normalizeTraceId(traceId)
  if (!value || typeof value !== 'object') {
    return buildErrorResult('云函数返回格式异常', 'SESSION_CORRUPTED', finalTraceId)
  }

  if (!value.trace_id) {
    return {
      ...value,
      trace_id: finalTraceId
    }
  }

  return value
}

function normalizeMobile(value) {
  return String(value || '').trim()
}

function escapeRegExp(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeAppointmentStatus(status) {
  if (!status) {
    return ''
  }
  const value = String(status)
  return ['pending', 'completed', 'cancelled'].includes(value) ? value : ''
}

function isDateYMD(value) {
  const text = String(value || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false
  }
  const time = Date.parse(text)
  return Number.isFinite(time)
}

function isStartNoLaterThanEnd(startDate, endDate) {
  if (!isDateYMD(startDate) || !isDateYMD(endDate)) {
    return false
  }
  return Date.parse(startDate) <= Date.parse(endDate)
}

function normalizeAdminId(value) {
  const text = String(value || '').trim()
  if (!text || text.length > 64) {
    return ''
  }
  return text
}

function normalizeTextField(value, maxLen) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }
  return text
}

function validateDateRangeFilter(startDate, endDate, requireBoth = false) {
  const start = String(startDate || '').trim()
  const end = String(endDate || '').trim()

  if (requireBoth && (!start || !end)) {
    return '日期范围参数不完整'
  }

  if (start && !isDateYMD(start)) {
    return '开始日期格式不合法'
  }

  if (end && !isDateYMD(end)) {
    return '结束日期格式不合法'
  }

  if (start && end && !isStartNoLaterThanEnd(start, end)) {
    return '日期范围参数不合法'
  }

  return ''
}

function normalizeScanSessionId(sessionId) {
  if (typeof sessionId !== 'string') {
    return ''
  }
  return sessionId.trim().toLowerCase()
}

function isValidScanSessionId(sessionId) {
  const normalized = normalizeScanSessionId(sessionId)
  return /^[a-z0-9]{32}$/.test(normalized)
}

async function expireLoginSession(sessionId, reason = '会话已过期') {
  const id = normalizeScanSessionId(sessionId)
  if (!isValidScanSessionId(id)) {
    return
  }

  try {
    await db.collection('login_sessions').doc(id).update({
      data: {
        status: 'expired',
        reject_reason: reason,
        expired_at: Date.now(),
        updated_at: Date.now()
      }
    })
  } catch (err) {
    console.error('更新扫码会话状态失败:', err.message || err)
  }
}

async function cleanupExpiredLoginSessions(now = Date.now()) {
  try {
    const stale = await db.collection('login_sessions')
      .where({
        status: _.neq('expired'),
        expires_at: _.lt(now)
      })
      .limit(100)
      .get()

    if (!stale || !stale.data || stale.data.length === 0) {
      return
    }

    for (const item of stale.data) {
      await db.collection('login_sessions')
        .doc(item._id)
        .update({
          data: {
            status: 'expired',
            reject_reason: '会话已过期',
            expired_at: Date.now(),
            updated_at: Date.now()
          }
        })
        .catch(() => {})
    }
  } catch (err) {
    console.error('清理扫码会话失败:', err.message || err)
  }
}

function normalizeLoginSessionEventId(sessionId) {
  return normalizeScanSessionId(sessionId)
}

function getScanSessionIdFromRequest(data) {
  const sessionId = normalizeLoginSessionEventId(data && data.session_id)
  if (!isValidScanSessionId(sessionId)) {
    return ''
  }
  return sessionId
}

function buildErrorResult(message, errorCode = '', traceId = '') {
  return {
    code: -1,
    message,
    errorCode,
    error_code: errorCode,
    trace_id: normalizeTraceId(traceId || CURRENT_TRACE_ID)
  }
}

function buildSuccessResult(data) {
  return {
    code: 0,
    data,
    trace_id: normalizeTraceId(CURRENT_TRACE_ID)
  }
}

function extractAdminSessionInput(event = {}) {
  if (!event || typeof event !== 'object') {
    return {}
  }

  const raw = event.admin_session
  if (raw && typeof raw === 'object') {
    return {
      token: raw.token || raw.admin_token || '',
      role: raw.role || '',
      permissions: raw.permissions || raw.permission || []
    }
  }

  if (typeof raw === 'string') {
    return { token: raw }
  }

  return {
    token: event.admin_token || ''
  }
}

async function writeAdminAuditLog(adminAuth, action, options = {}) {
  try {
    const tenantScope = (adminAuth && adminAuth.tenant_scope) || DEFAULT_TENANT_SCOPE
    const wxContext = cloud.getWXContext ? cloud.getWXContext() : {}
    const now = Date.now()
    await db.collection('admin_audit_logs').add({
      data: {
        admin_user_id: adminAuth ? adminAuth.admin_user_id : '',
        admin_username: adminAuth ? adminAuth.username : '',
        role: adminAuth ? adminAuth.role : '',
        tenant_scope: tenantScope,
        action,
        target_type: options.targetType || '',
        target_id: options.targetId || '',
        status: options.status || 'success',
        changes: options.changes || null,
        message: options.message || '',
        openid: wxContext.OPENID || '',
        created_at: now
      }
    })

    await cleanupAdminAuditLogs(now).catch(() => {})
  } catch (err) {
    console.error('审计日志记录失败:', err.message || err)
  }
}

async function cleanupAdminAuditLogs(now = Date.now()) {
  try {
    const expireBefore = now - ADMIN_AUDIT_LOG_RETENTION_MS
    const expired = await db.collection('admin_audit_logs')
      .where({ created_at: _.lt(expireBefore) })
      .limit(100)
      .get()

    if (expired && expired.data && expired.data.length > 0) {
      for (const item of expired.data) {
        await db.collection('admin_audit_logs').doc(item._id).remove().catch(() => {})
      }
    }

    const recent = await db.collection('admin_audit_logs')
      .orderBy('created_at', 'desc')
      .skip(ADMIN_AUDIT_LOG_KEEP_LIMIT)
      .get()

    if (recent && recent.data && recent.data.length > 0) {
      const cutoff = Number(recent.data[recent.data.length - 1].created_at || 0)
      if (cutoff > 0) {
        const tooMany = await db.collection('admin_audit_logs')
          .where({ created_at: _.lte(cutoff) })
          .limit(100)
          .get()
        if (tooMany && tooMany.data && tooMany.data.length > 0) {
          for (const item of tooMany.data) {
            await db.collection('admin_audit_logs').doc(item._id).remove().catch(() => {})
          }
        }
      }
    }
  } catch (err) {
    console.error('清理审计日志失败:', err.message || err)
  }
}

async function invalidateAdminSessionsByUser(adminUserId, reason = '管理员账号变更') {
  if (!adminUserId) {
    return 0
  }

  try {
    const activeSessions = await db.collection('admin_sessions')
      .where({ admin_user_id: adminUserId, status: 'active' })
      .limit(100)
      .get()

    if (!activeSessions || !activeSessions.data || activeSessions.data.length === 0) {
      return 0
    }

    const now = Date.now()
    let count = 0
    for (const item of activeSessions.data) {
      await db.collection('admin_sessions')
        .doc(item._id)
        .update({
          data: {
            status: 'logged_out',
            logout_reason: reason,
            last_accessed_at: now,
            updated_at: now
          }
        })
        .catch(() => {})
      count += 1
    }

    return count
  } catch (err) {
    console.error('失效管理员会话失败:', err.message || err)
    return 0
  }
}

function canAdminAccessAction(role, action) {
  const normalizedRole = normalizeAdminRole(role, '')
  const allowedActions = ADMIN_ACTION_PERMISSIONS[normalizedRole] || []
  return allowedActions.includes('*') || allowedActions.includes(action)
}

function sanitizeAdminUser(user = {}) {
  const safeUser = { ...user }
  delete safeUser.password_hash
  safeUser.role = normalizeAdminRole(safeUser.role, '')
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

function getScanSessionUrl(sessionId) {
  const scene = normalizeMiniProgramScene(sessionId)
  const page = getMiniProgramPagePath()
  if (!scene || !page) {
    return ''
  }

  return `${page}?session_id=${encodeURIComponent(scene)}`
}

function buildScanSessionResponse(sessionId, payload = {}) {
  const sessionExpireAt = Number(payload.expires_at || payload.session_expire_at || 0)
  return {
    ...payload,
    session_id: sessionId,
    confirm_url: getScanSessionUrl(sessionId),
    type: payload.type || 'admin_login',
    status: payload.status || 'pending',
    session_expire_at: sessionExpireAt,
    expires_at: sessionExpireAt
  }
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

  const { action: rawAction, data = {} } = event || {}
  const action = String(rawAction || '')
  CURRENT_TRACE_ID = normalizeTraceId(event && (event.trace_id || event.traceId || ''))

  try {
    // 受保护的 action 需要校验管理员会话和角色权限
    const protectedActions = [
      'getCurrentAdmin',
      'logout',
      'getAdminAuditLogs',
      'getServices', 'createService', 'updateService',
      'getTechnicians', 'createTechnician', 'updateTechnician', 'toggleTechnicianStatus', 'deleteTechnician',
      'getCustomers', 'updateCustomer', 'deleteCustomer', 'toggleBlacklist',
      'getAppointments', 'getAppointmentDetail',
      'addHoliday', 'deleteHoliday',
      'getTechDaysOff', 'addTechDayOff', 'deleteTechDayOff',
      'getCommissions', 'getCommissionSummary',
      'getArticles', 'createArticle', 'updateArticle', 'toggleArticleStatus', 'deleteArticle',
      'updateConfig', 'importHolidays',
      'getAdminUsers', 'addAdminUser', 'updateAdminUser', 'removeAdminUser', 'createAdminBindSession'
    ]

    let adminAuth = null

    if (protectedActions.includes(action)) {
      const authResult = await ensureAdminPermission(event, action)
      if (!authResult.ok) {
        return authResult.error
      }
      adminAuth = authResult.auth
    }

    const result = await (async () => {
      switch (action) {
      // 获取营业配置
      case 'getConfig':
        return await getConfig(event)
      case 'createAppointmentQrCode':
        return await createAppointmentQrCode(data)

      // 管理员登录
      case 'verifyAdminPassword':
        return await verifyAdminPassword(data)

      // 更新营业配置
      case 'updateConfig':
        return await updateConfig(adminAuth, data)

      // 服务管理
      case 'getServices':
        return await getServices()
      case 'createService':
        return await createService(adminAuth, data)
      case 'updateService':
        return await updateService(adminAuth, data)

      // 技师管理
      case 'getTechnicians':
        return await getTechnicians()
      case 'createTechnician':
        return await createTechnician(adminAuth, data)
      case 'updateTechnician':
        return await updateTechnician(adminAuth, data)
      case 'toggleTechnicianStatus':
        return await toggleTechnicianStatus(adminAuth, data)
      case 'deleteTechnician':
        return await deleteTechnician(adminAuth, data)

      // 客户管理
      case 'getCustomers':
        return await getCustomers(data)
      case 'updateCustomer':
        return await updateCustomer(adminAuth, data)
      case 'deleteCustomer':
        return await deleteCustomer(adminAuth, data)
      case 'toggleBlacklist':
        return await toggleBlacklist(adminAuth, data)

      // 预约管理
      case 'getAppointments':
        return await getAdminAppointments(data)
      case 'getAppointmentDetail':
        return await getAppointmentDetail(data)

      // 休息管理
      case 'getHolidays':
        return await getHolidays(data)
      case 'addHoliday':
        return await addHoliday(adminAuth, data)
      case 'deleteHoliday':
        return await deleteHoliday(adminAuth, data)
      case 'getTechDaysOff':
        return await getTechDaysOff()
      case 'addTechDayOff':
        return await addTechDayOff(adminAuth, data)
      case 'deleteTechDayOff':
        return await deleteTechDayOff(adminAuth, data)

      // 提成统计
      case 'getCommissions':
        return await getCommissions(data)
      case 'getCommissionSummary':
        return await getCommissionSummary(data)

      // 文章管理
      case 'getArticles':
        return await getArticles()
      case 'createArticle':
        return await createArticle(adminAuth, data)
      case 'updateArticle':
        return await updateArticle(adminAuth, data)
      case 'toggleArticleStatus':
        return await toggleArticleStatus(adminAuth, data)
      case 'deleteArticle':
        return await deleteArticle(adminAuth, data)

      // 导入法定节假日
      case 'importHolidays':
        return await importHolidays()

      // 管理员账号管理
      case 'getCurrentAdmin':
        return await getCurrentAdmin(adminAuth)
      case 'getAdminAuditLogs':
        return await getAdminAuditLogs(adminAuth, data)
      case 'getAdminUsers':
        return await getAdminUsers(adminAuth)
      case 'addAdminUser':
        return await addAdminUser(adminAuth, data)
      case 'updateAdminUser':
        return await updateAdminUser(adminAuth, data)
      case 'removeAdminUser':
        return await removeAdminUser(adminAuth, data)
      case 'logout':
        return await logoutAdmin(adminAuth)

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
        return buildErrorResult('未知操作', 'SESSION_CORRUPTED')
      }
    })()

    return withTraceId(result)
  } catch (err) {
    console.error(`操作 ${action} 失败:`, err)
    return buildErrorResult(err.message || '操作失败', 'SESSION_CORRUPTED')
  } finally {
    CURRENT_TRACE_ID = ''
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
  const role = normalizeAdminRole(data.role, '')
  if (!role) {
    throw new Error('管理员角色异常')
  }
  const permissions = getRolePermissions(role)
  const tenantScope = data.tenant_scope || DEFAULT_TENANT_SCOPE
  const adminUserId = data.admin_user_id || ''
  const sessionExpireAt = now + ADMIN_SESSION_TTL_MS

  if (adminUserId) {
    await invalidateAdminSessionsByUser(adminUserId, '重新登录')
  }

  await db.collection('admin_sessions').add({
    data: {
      _id: token,
      admin_user_id: adminUserId,
      username: data.username || '',
      role,
      permissions,
      tenant_scope: tenantScope,
      openid: data.openid || '',
      login_method: data.login_method || 'password',
      status: 'active',
      created_at: now,
      session_expire_at: sessionExpireAt,
      updated_at: now,
      last_login_at: now,
      expires_at: sessionExpireAt
    }
  })

  if (adminUserId) {
    await db.collection('admin_users').doc(adminUserId).update({
      data: {
        last_login_at: now,
        last_login_method: data.login_method || 'password',
        openid: data.openid || '',
        updated_at: now
      }
    }).catch(() => {})
  }

  return token
}

async function ensureAdminPermission(event, action) {
  const adminAuth = await getAdminAuth(event)
  if (!adminAuth) {
    return {
      ok: false,
      error: buildErrorResult('身份验证失败，请重新登录', 'SESSION_EXPIRED')
    }
  }

  if (!isRoleValid(adminAuth.role)) {
    return {
      ok: false,
      error: buildErrorResult('账号角色异常，请重新登录', 'ROLE_MISMATCH')
    }
  }

  if (!canAdminAccessAction(adminAuth.role, action)) {
    return {
      ok: false,
      error: buildErrorResult('当前账号无权限访问该功能', 'INSUFFICIENT_PERMISSION')
    }
  }

  return { ok: true, auth: adminAuth }
}

async function getAdminAuth(event = {}) {
  const sessionInput = extractAdminSessionInput(event)
  if (!sessionInput || !sessionInput.token) {
    return null
  }

  try {
    const sessionRes = await db.collection('admin_sessions').doc(sessionInput.token).get()
    const session = sessionRes.data
    if (!session) {
      return null
    }

    if (session.status && session.status !== 'active') {
      return null
    }

    const now = Date.now()
    const resolvedExpireAt = Number(session.expires_at || session.session_expire_at || 0)
    if (!resolvedExpireAt || now > resolvedExpireAt) {
      await db.collection('admin_sessions').doc(sessionInput.token).update({
        data: {
          status: 'expired'
        }
      }).catch(() => {})
      return null
    }

    const adminUserId = session.admin_user_id || ''
    let role = normalizeAdminRole(session.role, '')
    let username = session.username || ''
    let openid = session.openid || ''

    if (adminUserId) {
      const adminUserRes = await db.collection('admin_users').doc(adminUserId).get()
      if (!adminUserRes.data || (adminUserRes.data.status && adminUserRes.data.status !== 'active')) {
        return null
      }
      const adminRole = adminUserRes.data.role
      if (!isRoleValid(adminRole)) {
        return null
      }
      role = normalizeAdminRole(adminRole, '')
      username = adminUserRes.data.username || username
      openid = adminUserRes.data.openid || openid
    } else if (!isRoleValid(role)) {
      return null
    }

    const permissions = getRolePermissions(role)
    const resolvedTenantScope = session.tenant_scope || DEFAULT_TENANT_SCOPE
    const resolvedLastLoginAt = Number(session.last_login_at || session.updated_at || session.created_at || now)

    if (session.role !== role || JSON.stringify(session.permissions || []) !== JSON.stringify(permissions)) {
      db.collection('admin_sessions').doc(sessionInput.token).update({
        data: {
          role,
          permissions,
          tenant_scope: resolvedTenantScope,
          updated_at: now
        }
      }).catch(() => {})
    } else {
      db.collection('admin_sessions').doc(sessionInput.token).update({
        data: { last_accessed_at: now, updated_at: now }
      }).catch(() => {})
    }

    return {
      token: sessionInput.token,
      admin_user_id: adminUserId,
      admin_id: adminUserId,
      username,
      role,
      permissions,
      admin_permissions: permissions,
      tenant_scope: resolvedTenantScope,
      openid,
      session_expire_at: resolvedExpireAt,
      last_login_at: resolvedLastLoginAt,
      status: session.status || 'active',
      created_at: session.created_at || 0,
      updated_at: session.updated_at || 0
    }
  } catch (err) {
    console.error('会话校验失败:', err.message || err)
    return null
  }
}

async function validateAdminAuth(event = {}) {
  return Boolean(await getAdminAuth(event))
}

// ==================== 营业配置 ====================

function cleanConfigText(value, fallback = '', max = 40) {
  const text = String(value || fallback || '').trim()
  return text.slice(0, max)
}

function normalizeEnabled(value) {
  return value !== false
}

function normalizeHomeCards(input) {
  const source = Array.isArray(input) ? input : []
  return DEFAULT_HOME_CARDS.map((item) => {
    const saved = source.find(candidate => candidate && candidate.key === item.key) || {}
    return {
      key: item.key,
      title: cleanConfigText(saved.title, item.title, 24),
      enabled: normalizeEnabled(saved.enabled),
      sort: parseIntLike(saved.sort, item.sort)
    }
  }).sort((a, b) => a.sort - b.sort)
}

function normalizeFacilities(input) {
  if (input !== undefined && !Array.isArray(input)) {
    return DEFAULT_FACILITIES
  }
  const source = input === undefined ? DEFAULT_FACILITIES : input
  return source.slice(0, 12).map((item, index) => ({
    name: cleanConfigText(item && item.name, '', 16),
    icon: cleanConfigText(item && item.icon, 'shop-o', 24),
    enabled: normalizeEnabled(item && item.enabled),
    sort: parseIntLike(item && item.sort, index + 1)
  })).filter(item => item.name).sort((a, b) => a.sort - b.sort)
}

function normalizeRecommendedTechnicians(input) {
  if (input !== undefined && !Array.isArray(input)) {
    return DEFAULT_RECOMMENDED_TECHNICIANS
  }
  const source = input === undefined ? DEFAULT_RECOMMENDED_TECHNICIANS : input
  return source.slice(0, 12).map((item, index) => ({
    name: cleanConfigText(item && item.name, '', 16),
    specialty: cleanConfigText(item && item.specialty, '擅长中医调理', 32),
    enabled: normalizeEnabled(item && item.enabled),
    sort: parseIntLike(item && item.sort, index + 1)
  })).filter(item => item.name).sort((a, b) => a.sort - b.sort)
}

function withDisplayConfigDefaults(config = {}) {
  return {
    ...config,
    home_cards: normalizeHomeCards(config.home_cards),
    facilities: normalizeFacilities(config.facilities),
    recommended_technicians: normalizeRecommendedTechnicians(config.recommended_technicians)
  }
}

async function getConfig(event = {}) {
  const hasAdminAuth = await validateAdminAuth(event)

  const res = await db.collection('business_config').limit(1).get()
  if (res.data.length === 0) {
    // 创建默认配置
    const defaultConfig = {
      store: {
        name: '壹心堂中医门诊',
        phone: '',
        address: '',
        latitude: 0,
        longitude: 0
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
      max_advance_days: 14,
      home_cards: normalizeHomeCards(),
      facilities: normalizeFacilities(),
      recommended_technicians: normalizeRecommendedTechnicians()
    }

    await db.collection('business_config').add({ data: defaultConfig })
    return buildSuccessResult(sanitizeConfig(defaultConfig, hasAdminAuth))
  }

  return buildSuccessResult(sanitizeConfig(res.data[0], hasAdminAuth))
}

function sanitizeConfig(config, isAdmin) {
  const normalizedConfig = withDisplayConfigDefaults(config || {})
  if (isAdmin) {
    return normalizedConfig
  }

  const { admin_password, ...publicConfig } = normalizedConfig
  return publicConfig
}

async function verifyAdminPassword(data) {
  if (!data || !data.password || !data.username) {
    return buildErrorResult('请输入账号和密码', 'SESSION_CORRUPTED')
  }

  const username = (data.username || '').trim()
  const accountRes = await db.collection('admin_users').where({ username }).limit(1).get()
  if (accountRes.data.length === 0) {
    const bootstrapResult = await tryBootstrapFirstAdmin(username, data.password)
    if (bootstrapResult) {
      return bootstrapResult
    }

    return buildErrorResult('账号或密码错误', 'SESSION_CORRUPTED')
  }

  const account = accountRes.data[0]
  if (account.status && account.status !== 'active') {
    return buildErrorResult('账号已停用，请联系管理员', 'USER_DISABLED')
  }

  if (account.password_hash !== hashAdminPassword(data.password)) {
    return buildErrorResult('账号或密码错误', 'SESSION_CORRUPTED')
  }

  const role = normalizeAdminRole(account.role, '')
  if (!role) {
    return buildErrorResult('该管理员角色配置异常，请联系系统管理员', 'ROLE_MISMATCH')
  }

  const token = await createAdminSession({
    admin_user_id: account._id,
    username: account.username,
    role,
    login_method: 'password',
    openid: account.openid || ''
  })

  const sessionExpireAt = Date.now() + ADMIN_SESSION_TTL_MS
  await writeAdminAuditLog({
    admin_user_id: account._id,
    username: account.username,
    role: account.role,
    tenant_scope: DEFAULT_TENANT_SCOPE
  }, 'admin.login.password', {
    targetType: 'admin_user',
    targetId: account._id,
    status: 'success',
    message: '账号密码登录成功'
  })

  return buildSuccessResult({
    token,
    username: account.username,
    role,
    permissions: getRolePermissions(role),
    tenant_scope: DEFAULT_TENANT_SCOPE,
    session_expire_at: sessionExpireAt,
    last_login_at: Date.now(),
    admin_id: account._id,
    admin_user_id: account._id
  })
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
  return buildSuccessResult({
    token,
    username,
    role: 'super_admin',
    permissions: getRolePermissions('super_admin'),
    tenant_scope: DEFAULT_TENANT_SCOPE,
    session_expire_at: Date.now() + ADMIN_SESSION_TTL_MS,
    last_login_at: Date.now(),
    admin_id: addRes._id,
    admin_user_id: addRes._id,
    bootstrapped: true
  })
}

async function updateConfig(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('配置参数不能为空', 'SESSION_CORRUPTED')
  }

  if (!data.store || typeof data.store !== 'object') {
    return buildErrorResult('门店配置不合法', 'SESSION_CORRUPTED')
  }

  const scheduleInput = data.schedule
  if (!scheduleInput || typeof scheduleInput !== 'object') {
    return buildErrorResult('营业时间配置不合法', 'SESSION_CORRUPTED')
  }

  const validatedSchedule = {}
  for (let day = 1; day <= 7; day += 1) {
    const rawPeriods = scheduleInput[day] || scheduleInput[String(day)] || []
    if (!Array.isArray(rawPeriods)) {
      return buildErrorResult(`星期${day}营业时间配置不合法`, 'SESSION_CORRUPTED')
    }
    if (rawPeriods.length > 3) {
      return buildErrorResult(`星期${day}最多支持3个营业时段`, 'SESSION_CORRUPTED')
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/
    const cleanedPeriods = []
    for (const item of rawPeriods) {
      const start = String(item && item.start || '').trim()
      const end = String(item && item.end || '').trim()
      if (!start || !end) {
        return buildErrorResult(`星期${day}时段配置不能为空`, 'SESSION_CORRUPTED')
      }
      if (!timeRegex.test(start) || !timeRegex.test(end)) {
        return buildErrorResult(`星期${day}时段时间格式不合法`, 'SESSION_CORRUPTED')
      }
      if (start >= end) {
        return buildErrorResult(`星期${day}存在起止时间异常的时段`, 'SESSION_CORRUPTED')
      }
      cleanedPeriods.push({ start, end })
    }

    const sortedPeriods = [...cleanedPeriods].sort((a, b) => a.start.localeCompare(b.start))
    for (let i = 1; i < sortedPeriods.length; i += 1) {
      if (sortedPeriods[i].start < sortedPeriods[i - 1].end) {
        return buildErrorResult(`星期${day}营业时段存在重叠`, 'SESSION_CORRUPTED')
      }
    }
    validatedSchedule[day] = sortedPeriods
  }

  const sanitized = {
    store: data.store || {},
    schedule: validatedSchedule,
    slot_interval: Number(data.slot_interval || 30),
    holidays: Array.isArray(data.holidays) ? data.holidays : [],
    max_advance_days: parseIntLike(data.max_advance_days, 14),
    home_cards: normalizeHomeCards(data.home_cards),
    facilities: normalizeFacilities(data.facilities),
    recommended_technicians: normalizeRecommendedTechnicians(data.recommended_technicians)
  }

  const phone = String(sanitized.store.phone || '')
  if (phone && !/^1\d{10}$/.test(phone)) {
    return buildErrorResult('门店联系电话格式不正确', 'SESSION_CORRUPTED')
  }

  if (sanitized.slot_interval < 15 || sanitized.slot_interval > 240) {
    return buildErrorResult('时间粒度范围不合法', 'SESSION_CORRUPTED')
  }

  if (sanitized.max_advance_days < 1 || sanitized.max_advance_days > 90) {
    return buildErrorResult('可预约天数范围不合法', 'SESSION_CORRUPTED')
  }

  const res = await db.collection('business_config').limit(1).get()

  if (res.data.length === 0) {
    await db.collection('business_config').add({ data: sanitized })
  } else {
  await db.collection('business_config')
    .doc(res.data[0]._id)
    .update({ data: sanitized })

  await writeAdminAuditLog(adminAuth, 'admin.config.update', {
    targetType: 'business_config',
    targetId: res.data[0]?._id || '',
    status: 'success',
    changes: sanitized,
    message: '更新营业配置'
  })
  }

  return buildSuccessResult({ message: '更新成功' })
}

async function logoutAdmin(adminAuth) {
  if (!adminAuth || !adminAuth.token) {
    return buildErrorResult('身份验证失败，请重新登录', 'TOKEN_EXPIRED')
  }

  const now = Date.now()
  await db.collection('admin_sessions')
    .doc(adminAuth.token)
    .update({
      data: {
        status: 'logged_out',
        last_accessed_at: now,
        updated_at: now
      }
    })
    .catch(() => {})

  await writeAdminAuditLog(adminAuth, 'admin.logout', {
    targetType: 'admin_user',
    targetId: adminAuth.admin_user_id,
    status: 'success',
    message: '管理员退出登录'
  })

  return buildSuccessResult({
    message: '退出登录成功',
    status: 'logged_out',
    session_id: adminAuth.token
  })
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

  return buildSuccessResult(res.data)
}

async function createService(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const name = String(data.name || '').trim()
  if (!name) {
    return buildErrorResult('服务名称不能为空', 'SESSION_CORRUPTED')
  }
  if (name.length > 60) {
    return buildErrorResult('服务名称长度不能超过60个字符', 'SESSION_CORRUPTED')
  }

  const duration = Number(data.duration || 0)
  if (!Number.isInteger(duration) || duration < 15 || duration > 720) {
    return buildErrorResult('服务时长不合法', 'SESSION_CORRUPTED')
  }

  const price = Number(data.price || 0)
  const defaultCommission = Number(data.default_commission || 0)
  const sortOrder = Number(data.sort_order || 0)
  if (!Number.isInteger(price) || price < 0 || !Number.isInteger(defaultCommission) || defaultCommission < 0) {
    return buildErrorResult('金额应为非负整数', 'SESSION_CORRUPTED')
  }
  if (defaultCommission > price) {
    return buildErrorResult('默认提成不能大于服务价格', 'SESSION_CORRUPTED')
  }

  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    return buildErrorResult('排序值不合法', 'SESSION_CORRUPTED')
  }

  const status = data.status || 'active'
  if (!['active', 'inactive'].includes(status)) {
    return buildErrorResult('服务状态不合法', 'SESSION_CORRUPTED')
  }

  const imageUrl = String(data.image_url || data.imageUrl || '').trim()
  const description = String(data.description || '').trim()
  if (description.length > 500) {
    return buildErrorResult('服务描述不能超过500个字符', 'SESSION_CORRUPTED')
  }

  const res = await db.collection('services').add({
    data: {
      name,
      duration: parseIntLike(duration),
      price: parseIntLike(price, 0),
      default_commission: parseIntLike(defaultCommission, 0),
      sort_order: parseIntLike(sortOrder, 0),
      status,
      image_url: imageUrl,
      description,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  await writeAdminAuditLog(adminAuth, 'admin.service.create', {
    targetType: 'service',
    targetId: res._id || '',
    status: 'success',
    changes: {
      name,
      duration: parseIntLike(duration),
      price: parseIntLike(price, 0)
    },
    message: '新增服务'
  })

  return buildSuccessResult({ _id: res._id })
}

async function updateService(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const { id, ...updateData } = data
  if (!id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }

  const patch = {}
  const target = await db.collection('services').doc(id).get()
  if (!target.data) {
    return buildErrorResult('目标服务不存在', 'SESSION_CORRUPTED')
  }

  const existingPrice = Number(target.data.price || 0)
  if (!Number.isInteger(existingPrice) || existingPrice < 0) {
    return buildErrorResult('目标服务价格异常', 'SESSION_CORRUPTED')
  }

  let effectivePrice = existingPrice

  // 统一图片字段为 image_url
  if (updateData.imageUrl !== undefined) {
    updateData.image_url = updateData.imageUrl
    delete updateData.imageUrl
  }
  if (updateData.name !== undefined) {
    const name = String(updateData.name || '').trim()
    if (!name) {
      return buildErrorResult('服务名称不能为空', 'SESSION_CORRUPTED')
    }
    if (name.length > 60) {
      return buildErrorResult('服务名称长度不能超过60个字符', 'SESSION_CORRUPTED')
    }
    patch.name = name
  }
  if (updateData.duration !== undefined) {
    const duration = Number(updateData.duration)
    if (!Number.isInteger(duration) || duration < 15 || duration > 720) {
      return buildErrorResult('服务时长不合法', 'SESSION_CORRUPTED')
    }
    patch.duration = parseIntLike(duration, 0)
  }
  if (updateData.price !== undefined) {
    const price = Number(updateData.price)
    if (!Number.isInteger(price) || price < 0) {
      return buildErrorResult('服务价格不能小于0', 'SESSION_CORRUPTED')
    }
    effectivePrice = parseIntLike(price, 0)
    patch.price = effectivePrice
  }
  if (updateData.default_commission !== undefined) {
    const defaultCommission = Number(updateData.default_commission)
    if (!Number.isInteger(defaultCommission) || defaultCommission < 0) {
      return buildErrorResult('默认提成不能小于0', 'SESSION_CORRUPTED')
    }

    if (defaultCommission > effectivePrice) {
      return buildErrorResult('默认提成不能大于服务价格', 'SESSION_CORRUPTED')
    }
    patch.default_commission = parseIntLike(defaultCommission, 0)
  }
  if (updateData.status !== undefined && !['active', 'inactive'].includes(updateData.status)) {
    return buildErrorResult('服务状态不合法', 'SESSION_CORRUPTED')
  }
  if (updateData.status !== undefined) {
    patch.status = updateData.status
  }

  if (updateData.sort_order !== undefined) {
    const sortOrder = Number(updateData.sort_order)
    if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      return buildErrorResult('排序值不合法', 'SESSION_CORRUPTED')
    }
    patch.sort_order = parseIntLike(sortOrder, 0)
  }

  if (updateData.image_url !== undefined) {
    patch.image_url = String(updateData.image_url).trim()
  }

  if (updateData.description !== undefined) {
    const description = String(updateData.description || '').trim()
    if (description.length > 500) {
      return buildErrorResult('服务描述不能超过500个字符', 'SESSION_CORRUPTED')
    }
    patch.description = description
  }

  if (Object.keys(patch).length === 0) {
    return buildSuccessResult({ message: '未修改任何字段' })
  }

  await db.collection('services')
    .doc(id)
    .update({
      data: {
        ...patch,
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.service.update', {
    targetType: 'service',
    targetId: id,
    status: 'success',
    changes: patch,
    message: '更新服务'
  })

  return buildSuccessResult({ message: '更新成功' })
}

// ==================== 技师管理 ====================

async function getTechnicians() {
  const res = await db.collection('technicians')
    .where({ status: _.neq('deleted') })
    .orderBy('created_at', 'desc')
    .get()

  return buildSuccessResult(res.data)
}

async function createTechnician(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const name = String(data.name || '').trim()
  const phone = normalizeMobile(data.phone)
  const openid = String(data.openid || '').trim()
  if (!name) {
    return buildErrorResult('技师姓名不能为空', 'SESSION_CORRUPTED')
  }
  if (name.length > 32) {
    return buildErrorResult('技师姓名长度不能超过32个字符', 'SESSION_CORRUPTED')
  }
  if (!/^1\d{10}$/.test(phone)) {
    return buildErrorResult('手机号格式不正确', 'SESSION_CORRUPTED')
  }

  // 检查手机号是否已存在
  const existing = await db.collection('technicians')
    .where({ phone, status: _.neq('deleted') })
    .get()

  if (existing.data.length > 0) {
    return buildErrorResult('该手机号已被注册', 'SESSION_CORRUPTED')
  }

  if (openid) {
    const existingOpenid = await db.collection('technicians')
      .where({ openid, status: _.neq('deleted') })
      .get()
    if (existingOpenid.data.length > 0) {
      return buildErrorResult('该微信已绑定其他技师', 'SESSION_CORRUPTED')
    }
  }

  const res = await db.collection('technicians').add({
    data: {
      name,
      phone,
      openid: openid || '',
      custom_commissions: {},
      status: 'active',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  await writeAdminAuditLog(adminAuth, 'admin.technician.create', {
    targetType: 'technician',
    targetId: res._id || '',
    status: 'success',
    changes: { name, phone },
    message: '新增技师'
  })

  return buildSuccessResult({ _id: res._id })
}

async function updateTechnician(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const { id, ...updateData } = data
  if (!id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }

  const patch = {}
  if (updateData.name !== undefined) {
    const name = String(updateData.name || '').trim()
    if (!name) {
      return buildErrorResult('技师姓名不能为空', 'SESSION_CORRUPTED')
    }
    if (name.length > 32) {
      return buildErrorResult('技师姓名长度不能超过32个字符', 'SESSION_CORRUPTED')
    }
    patch.name = name
  }
  if (updateData.phone !== undefined) {
    const phone = normalizeMobile(updateData.phone)
    if (!/^1\d{10}$/.test(phone)) {
      return buildErrorResult('手机号格式不正确', 'SESSION_CORRUPTED')
    }
    const existing = await db.collection('technicians')
      .where({ phone, _id: _.neq(id), status: _.neq('deleted') })
      .get()

    if (existing.data.length > 0) {
      return buildErrorResult('该手机号已被注册', 'SESSION_CORRUPTED')
    }
    patch.phone = phone
  }
  if (updateData.status !== undefined && !['active', 'inactive'].includes(updateData.status)) {
    return buildErrorResult('状态不合法', 'SESSION_CORRUPTED')
  }
  if (updateData.status !== undefined) {
    patch.status = updateData.status
  }

  if (updateData.custom_commissions !== undefined) {
    if (updateData.custom_commissions && typeof updateData.custom_commissions !== 'object') {
      return buildErrorResult('提成设置不合法', 'SESSION_CORRUPTED')
    }
    const cleanedCommissions = {}
    Object.keys(updateData.custom_commissions || {}).forEach((serviceId) => {
      const value = Number(updateData.custom_commissions[serviceId])
      if (!Number.isFinite(value) || value < 0) {
        return
      }
      cleanedCommissions[serviceId] = Math.min(999900, parseIntLike(value, 0))
    })
    patch.custom_commissions = cleanedCommissions
  }

  if (updateData.openid !== undefined) {
    const openid = String(updateData.openid).trim()
    if (openid) {
      const bound = await db.collection('technicians')
        .where({ openid, _id: _.neq(id), status: _.neq('deleted') })
        .get()

      if (bound.data.length > 0) {
        return buildErrorResult('该微信已绑定其他技师', 'SESSION_CORRUPTED')
      }
    }
    patch.openid = openid
  }

  if (Object.keys(patch).length === 0) {
    return buildSuccessResult({ message: '未修改任何字段' })
  }

  await db.collection('technicians')
    .doc(id)
    .update({
      data: {
        ...patch,
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.technician.update', {
    targetType: 'technician',
    targetId: id,
    status: 'success',
    changes: updateData,
    message: '更新技师'
  })

  return buildSuccessResult({ message: '更新成功' })
}

async function deleteTechnician(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }

  const target = await db.collection('technicians').doc(data.id).get()
  if (!target.data || target.data.status === 'deleted') {
    return buildErrorResult('技师不存在或已删除', 'SESSION_CORRUPTED')
  }

  await db.collection('technicians')
    .doc(data.id)
    .update({
      data: {
        status: 'deleted',
        deleted_at: db.serverDate(),
        deleted_by: adminAuth.admin_user_id || '',
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.technician.delete', {
    targetType: 'technician',
    targetId: data.id,
    status: 'success',
    changes: { status: 'deleted' },
    message: '删除技师'
  })

  return buildSuccessResult({ message: '删除成功' })
}

// ==================== 客户管理 ====================

async function getCustomers(params) {
  const page = normalizePagination(params && params.page, 1, 200)
  const pageSize = normalizePagination(params && params.page_size, 20, 200)

  let conditions = null
  if (params && params.keyword) {
    const keyword = String(params.keyword).trim()
    if (keyword.length > 30) {
      return buildErrorResult('搜索关键字过长', 'SESSION_CORRUPTED')
    }
    const safeKeyword = escapeRegExp(keyword)
    conditions = _.or([
      { nick_name: db.RegExp({ regexp: safeKeyword, options: 'i' }) },
      { phone: db.RegExp({ regexp: safeKeyword, options: 'i' }) }
    ])
  }

  let countQuery = db.collection('users').where({ status: _.neq('deleted') })
  let dataQuery = db.collection('users').where({ status: _.neq('deleted') })

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

  return buildSuccessResult({ list: res.data, total })
}

async function updateCustomer(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const { id, ...updateData } = data
  if (!id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }

  const patch = {}

  if (updateData.nick_name !== undefined) {
    const nickName = String(updateData.nick_name || '').trim()
    if (nickName.length > 32) {
      return buildErrorResult('昵称长度不能超过32个字符', 'SESSION_CORRUPTED')
    }
    patch.nick_name = nickName
  }

  if (updateData.phone !== undefined) {
    const phone = normalizeMobile(updateData.phone)
    if (phone && !/^1\d{10}$/.test(phone)) {
      return buildErrorResult('手机号格式不正确', 'SESSION_CORRUPTED')
    }
    patch.phone = phone
  }

  if (updateData.notes !== undefined) {
    const notes = String(updateData.notes || '').trim()
    if (notes.length > 1000) {
      return buildErrorResult('备注内容过长，请缩短后再试', 'SESSION_CORRUPTED')
    }
    patch.notes = notes
  }

  if (Object.keys(patch).length === 0) {
    return buildErrorResult('未修改可变更字段', 'SESSION_CORRUPTED')
  }

  const target = await db.collection('users').doc(id).get()
  if (!target.data || target.data.status === 'deleted') {
    return buildErrorResult('目标客户不存在或已删除', 'SESSION_CORRUPTED')
  }

  await db.collection('users')
    .doc(id)
    .update({
      data: {
        ...patch,
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.customer.update', {
    targetType: 'user',
    targetId: id,
    status: 'success',
    changes: updateData,
    message: '更新客户信息'
  })

  return buildSuccessResult({ message: '更新成功' })
}

async function deleteCustomer(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }

  const target = await db.collection('users').doc(data.id).get()
  if (!target.data || target.data.status === 'deleted') {
    return buildErrorResult('客户不存在或已删除', 'SESSION_CORRUPTED')
  }

  await db.collection('users')
    .doc(data.id)
    .update({
      data: {
        status: 'deleted',
        deleted_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.customer.delete', {
    targetType: 'user',
    targetId: data.id,
    status: 'success',
    message: '删除客户'
  })

  return buildSuccessResult({ message: '删除成功' })
}

// ==================== 预约管理 ====================

async function getAdminAppointments(params) {
  const page = normalizePagination(params && params.page, 1, 200)
  const pageSize = normalizePagination(params && params.page_size, 20, 200)
  const normalizedStatus = normalizeAppointmentStatus(params && params.status)

  let conditions = {}
  if (params) {
    if (params.status) {
      if (!normalizedStatus) {
        return buildErrorResult('状态参数不合法', 'SESSION_CORRUPTED')
      }
      conditions.status = normalizedStatus
    }
    if (params.technician_id) {
      conditions.technician_id = String(params.technician_id).trim()
    }
    if (params.patient_openid) {
      conditions.patient_openid = String(params.patient_openid).trim()
    }
    if (params.start_date && params.end_date) {
      if (!isDateYMD(params.start_date) || !isDateYMD(params.end_date)) {
        return buildErrorResult('日期范围参数不合法', 'SESSION_CORRUPTED')
      }
      if (!isStartNoLaterThanEnd(params.start_date, params.end_date)) {
        return buildErrorResult('日期范围参数不合法', 'SESSION_CORRUPTED')
      }
      conditions.date = _.gte(params.start_date).and(_.lte(params.end_date))
    } else if (params.start_date) {
      if (!isDateYMD(params.start_date)) {
        return buildErrorResult('日期参数不合法', 'SESSION_CORRUPTED')
      }
      conditions.date = params.start_date
    } else if (params.date) {
      if (!isDateYMD(params.date)) {
        return buildErrorResult('日期参数不合法', 'SESSION_CORRUPTED')
      }
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

  return buildSuccessResult({ list: appointments, total })
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

  return buildSuccessResult(res.data)
}

async function addHoliday(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const date = String(data.date || '').trim()
  if (!isDateYMD(date)) {
    return buildErrorResult('节假日日期格式不合法', 'SESSION_CORRUPTED')
  }

  const type = data.type || 'closure'
  if (!['closure', 'special'].includes(type)) {
    return buildErrorResult('节假日类型不合法', 'SESSION_CORRUPTED')
  }

  const reason = normalizeTextField(data.reason, 100)
  if (!reason || reason.length > 100) {
    return buildErrorResult(reason ? '节假日说明不能超过 100 字' : '节假日说明不能为空', 'SESSION_CORRUPTED')
  }

  const dateError = validateDateRangeFilter(date)
  if (dateError) {
    return buildErrorResult(dateError, 'SESSION_CORRUPTED')
  }

  // 检查是否已存在
  const existing = await db.collection('holidays')
    .where({ date, type })
    .get()

  if (existing.data.length > 0) {
    return buildErrorResult('该日期已存在', 'SESSION_CORRUPTED')
  }

  const res = await db.collection('holidays').add({
    data: {
      date,
      type,
      reason,
      tenant_scope: DEFAULT_TENANT_SCOPE,
      created_at: db.serverDate()
    }
  })

  await writeAdminAuditLog(adminAuth, 'admin.holiday.add', {
    targetType: 'holiday',
    targetId: res._id || '',
    status: 'success',
    changes: data,
    message: '新增节假日休息日'
  })

  return buildSuccessResult({ _id: res._id })
}

async function deleteHoliday(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
  return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }
  await db.collection('holidays').doc(data.id).remove()

  await writeAdminAuditLog(adminAuth, 'admin.holiday.delete', {
    targetType: 'holiday',
    targetId: data.id,
    status: 'success',
    message: '删除节假日休息日'
  })
  return buildSuccessResult({ message: '删除成功' })
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

  return buildSuccessResult(daysOff)
}

async function addTechDayOff(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const technicianId = normalizeAdminId(data.technician_id)
  const date = String(data.date || '').trim()
  if (!technicianId || !isDateYMD(date)) {
    return buildErrorResult('缺少技师或日期', 'SESSION_CORRUPTED')
  }

  const technicianRes = await db.collection('technicians')
    .doc(technicianId)
    .get()

  if (!technicianRes.data || technicianRes.data.status === 'deleted') {
    return buildErrorResult('关联技师不存在', 'SESSION_CORRUPTED')
  }

  const reason = normalizeTextField(data.reason, 80)
  if (reason && reason.length > 80) {
    return buildErrorResult('休息原因不能超过80个字符', 'SESSION_CORRUPTED')
  }

  const dateError = validateDateRangeFilter(date)
  if (dateError) {
    return buildErrorResult(dateError, 'SESSION_CORRUPTED')
  }

  // 检查是否已存在
  const existing = await db.collection('tech_days_off')
    .where({
      technician_id: technicianId,
      date
    })
    .get()

  if (existing.data.length > 0) {
    return buildErrorResult('该技师当天已有休假记录', 'SESSION_CORRUPTED')
  }

  const res = await db.collection('tech_days_off').add({
    data: {
      technician_id: technicianId,
      technician_name: technicianRes.data.name || '',
      date,
      reason: reason || '',
      created_at: db.serverDate()
    }
  })

  await writeAdminAuditLog(adminAuth, 'admin.tech_dayoff.add', {
    targetType: 'tech_days_off',
    targetId: res._id || '',
    status: 'success',
    changes: data,
    message: '新增技师休息日'
  })

  return buildSuccessResult({ _id: res._id })
}

async function deleteTechDayOff(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }
  await db.collection('tech_days_off').doc(data.id).remove()

  await writeAdminAuditLog(adminAuth, 'admin.tech_dayoff.delete', {
    targetType: 'tech_days_off',
    targetId: data.id,
    status: 'success',
    message: '删除技师休息日'
  })
  return buildSuccessResult({ message: '删除成功' })
}

// ==================== 提成统计 ====================

async function getCommissions(params) {
  const page = normalizePagination(params && params.page, 1, 200)
  const pageSize = normalizePagination(params && params.page_size, 20, 200)

  let conditions = {}
  const technicianId = normalizeAdminId(params && params.technician_id)
  const hasDateFilter = Boolean((params && (params.start_date || params.end_date)))
  const dateError = validateDateRangeFilter(params && params.start_date, params && params.end_date, hasDateFilter)
  if (dateError) {
    return buildErrorResult(dateError, 'SESSION_CORRUPTED')
  }

  if (params) {
    if (technicianId) {
      if (technicianId.length > 64) {
        return buildErrorResult('技师 id 长度不合法', 'SESSION_CORRUPTED')
      }
      conditions.technician_id = technicianId
    }
    if (params.start_date && params.end_date) {
      conditions.date = _.gte(String(params.start_date).trim()).and(_.lte(String(params.end_date).trim()))
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

  return buildSuccessResult({ list: res.data, total })
}

async function getCommissionSummary(params) {
  let conditions = {}
  const technicianId = normalizeAdminId(params && params.technician_id)
  const hasDateFilter = Boolean((params && (params.start_date || params.end_date)))
  const dateError = validateDateRangeFilter(params && params.start_date, params && params.end_date, hasDateFilter)
  if (dateError) {
    return buildErrorResult(dateError, 'SESSION_CORRUPTED')
  }

  if (params) {
    if (technicianId) {
      if (technicianId.length > 64) {
        return buildErrorResult('技师 id 长度不合法', 'SESSION_CORRUPTED')
      }
      conditions.technician_id = technicianId
    }
    if (params.start_date && params.end_date) {
      conditions.date = _.gte(String(params.start_date).trim()).and(_.lte(String(params.end_date).trim()))
    }
  }

  let query = db.collection('commission_records')
  if (Object.keys(conditions).length > 0) {
    query = query.where(conditions)
  }

  const res = await query.get()

  const total = res.data.reduce((sum, item) => sum + (item.commission_amount || 0), 0)
  const count = res.data.length

  return buildSuccessResult({ total, count })
}

// ==================== 文章管理 ====================

async function getArticles() {
  const res = await db.collection('articles')
    .where({ status: _.neq('deleted') })
    .orderBy('sort_order', 'asc')
    .get()

  return buildSuccessResult(res.data)
}

async function createArticle(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const title = String(data.title || '').trim()
  if (!title) {
    return buildErrorResult('文章标题不能为空', 'SESSION_CORRUPTED')
  }
  if (title.length > 80) {
    return buildErrorResult('文章标题不能超过80个字符', 'SESSION_CORRUPTED')
  }

  const summary = String(data.summary || '').trim()
  if (summary.length > 300) {
    return buildErrorResult('文章摘要不能超过300个字符', 'SESSION_CORRUPTED')
  }

  const status = data.status || 'draft'
  if (!['draft', 'published', 'hidden', 'deleted'].includes(status)) {
    return buildErrorResult('文章状态不合法', 'SESSION_CORRUPTED')
  }

  const res = await db.collection('articles').add({
    data: {
      title,
      summary,
      cover_image: String(data.cover_image || '').trim(),
      content: String(data.content || '').trim(),
      sort_order: Number.isFinite(Number(data.sort_order)) ? parseIntLike(data.sort_order, 0) : 0,
      status,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  await writeAdminAuditLog(adminAuth, 'admin.article.create', {
    targetType: 'article',
    targetId: res._id || '',
    status: 'success',
    changes: {
      title,
      status
    },
    message: '新增文章'
  })

  return buildSuccessResult({ _id: res._id })
}

async function updateArticle(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const { id, ...updateData } = data
  if (!id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }

  const patch = {}

  if (updateData.title !== undefined) {
    const title = String(updateData.title || '').trim()
    if (!title) {
      return buildErrorResult('文章标题不能为空', 'SESSION_CORRUPTED')
    }
    if (title.length > 80) {
      return buildErrorResult('文章标题不能超过80个字符', 'SESSION_CORRUPTED')
    }
    patch.title = title
  }

  if (updateData.summary !== undefined) {
    const summary = String(updateData.summary || '').trim()
    if (summary.length > 300) {
      return buildErrorResult('文章摘要不能超过300个字符', 'SESSION_CORRUPTED')
    }
    patch.summary = summary
  }

  if (updateData.cover_image !== undefined) {
    patch.cover_image = String(updateData.cover_image || '').trim()
  }

  if (updateData.content !== undefined) {
    patch.content = String(updateData.content || '').trim()
  }

  if (updateData.sort_order !== undefined) {
    const sortOrder = Number(updateData.sort_order)
    if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      return buildErrorResult('排序值不合法', 'SESSION_CORRUPTED')
    }
    patch.sort_order = parseIntLike(sortOrder, 0)
  }

  if (updateData.status !== undefined && !['draft', 'published', 'hidden'].includes(updateData.status)) {
    return buildErrorResult('文章状态不合法', 'SESSION_CORRUPTED')
  }
  if (updateData.status !== undefined) {
    patch.status = updateData.status
  }

  if (Object.keys(patch).length === 0) {
    return buildSuccessResult({ message: '未修改任何字段' })
  }

  await db.collection('articles')
    .doc(id)
    .update({
      data: {
        ...patch,
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.article.update', {
    targetType: 'article',
    targetId: id,
    status: 'success',
    changes: patch,
    message: '更新文章'
  })

  return buildSuccessResult({ message: '更新成功' })
}

async function toggleArticleStatus(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }
  if (!data.status) {
    return buildErrorResult('缺少文章状态', 'SESSION_CORRUPTED')
  }
  if (!['draft', 'published', 'hidden'].includes(data.status)) {
    return buildErrorResult('文章状态不合法', 'SESSION_CORRUPTED')
  }
  await db.collection('articles')
    .doc(data.id)
    .update({
      data: {
        status: data.status,
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.article.status', {
    targetType: 'article',
    targetId: data.id,
    status: 'success',
    changes: { status: data.status },
    message: '切换文章状态'
  })

  return buildSuccessResult({ message: '状态更新成功' })
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value === 1
  }

  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true'
  }

  return false
}

async function deleteArticle(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }

  await db.collection('articles').doc(data.id).update({
    data: {
      status: 'deleted',
      updated_at: db.serverDate()
    }
  })

  await writeAdminAuditLog(adminAuth, 'admin.article.delete', {
    targetType: 'article',
    targetId: data.id,
    status: 'success',
    message: '删除文章'
  })

  return buildSuccessResult({ message: '删除成功' })
}

// ==================== 新增功能 ====================

async function getAppointmentDetail(data) {
  if (!data || !data.id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
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

  return buildSuccessResult({
    ...apt,
    service_names: serviceNames,
    technician_name: technicianName,
    patient_name: patientName,
    patient_phone: patientPhone
  })
}

async function toggleBlacklist(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }

  if (!['boolean', 'number', 'string'].includes(typeof data.is_blacklisted) ||
    (typeof data.is_blacklisted === 'string' && !['0', '1', 'true', 'false'].includes(data.is_blacklisted))) {
    return buildErrorResult('黑名单状态不合法', 'SESSION_CORRUPTED')
  }

  const isBlacklisted = normalizeBoolean(data.is_blacklisted)
  await db.collection('users')
    .doc(data.id)
    .update({
      data: {
        is_blacklisted: isBlacklisted,
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.customer.blacklist', {
    targetType: 'user',
    targetId: data.id,
    status: 'success',
    changes: { is_blacklisted: isBlacklisted },
    message: isBlacklisted ? '加入黑名单' : '移除黑名单'
  })

  return buildSuccessResult({ message: isBlacklisted ? '已加入黑名单' : '已取消黑名单' })
}

async function toggleTechnicianStatus(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少必要参数: id', 'SESSION_CORRUPTED')
  }
  if (!['active', 'inactive'].includes(data.status)) {
    return buildErrorResult('技师状态不合法', 'SESSION_CORRUPTED')
  }

  await db.collection('technicians')
    .doc(data.id)
    .update({
      data: {
        status: data.status,
        updated_at: db.serverDate()
      }
    })

  await writeAdminAuditLog(adminAuth, 'admin.technician.status', {
    targetType: 'technician',
    targetId: data.id,
    status: 'success',
    changes: { status: data.status },
    message: '更新技师状态'
  })

  return buildSuccessResult({ message: '状态更新成功' })
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

function normalizeLoginSessionType(type = '') {
  return type === 'admin_bind' ? 'admin_bind' : 'admin_login'
}

async function createLoginSession(data = {}) {
  await cleanupExpiredLoginSessions()

  const sessionId = normalizeMiniProgramScene(generateSessionId())
  if (!sessionId) {
    return buildErrorResult('会话创建失败', 'SESSION_CORRUPTED')
  }

  const now = Date.now()
  const expiresAt = now + LOGIN_SESSION_TTL_MS

  await db.collection('login_sessions').add({
    data: {
      _id: sessionId,
      status: 'pending',
      type: 'admin_login',
      openid: '',
      qr_source: data.prefer_miniprogram_qr ? 'miniprogram' : 'default',
      created_at: now,
      expires_at: expiresAt,
      tenant_scope: DEFAULT_TENANT_SCOPE,
      session_expire_at: expiresAt
    }
  })

  await writeAdminAuditLog(
    {},
    'admin.scan_qr.create',
    {
      targetType: 'login_session',
      targetId: sessionId,
      status: 'success',
      message: '管理员扫码登录二维码创建',
      changes: {
        type: 'admin_login',
        source: data.prefer_miniprogram_qr ? 'miniprogram' : 'default'
      }
    }
  )

  const qrCodeBase64 = await createMiniProgramLoginQrCode(sessionId)
  if (!qrCodeBase64) {
    await db.collection('login_sessions').doc(sessionId).update({
      data: {
        status: 'expired',
        reject_reason: '小程序码生成失败'
      }
    })
    return buildErrorResult('小程序码生成失败，请检查微信 AppSecret 或云调用权限配置', 'SESSION_CORRUPTED')
  }

  return buildSuccessResult(buildScanSessionResponse(sessionId, {
    status: 'pending',
    type: 'admin_login',
    username: '',
    expires_at: expiresAt,
    qr_code_base64: qrCodeBase64,
    qr_code_type: 'miniprogram',
    message: '请使用微信扫码完成登录确认'
  }))
}

async function createAdminBindSession(data = {}) {
  await cleanupExpiredLoginSessions()

  if (!data || !data.id) {
    return buildErrorResult('缺少管理员账号 id', 'SESSION_CORRUPTED')
  }

  const adminRes = await db.collection('admin_users').doc(data.id).get()
  if (!adminRes.data) {
    return buildErrorResult('管理员账号不存在', 'SESSION_CORRUPTED')
  }

  if (adminRes.data.status && adminRes.data.status !== 'active') {
    return buildErrorResult('管理员账号已停用，不能生成绑定二维码', 'SESSION_CORRUPTED')
  }

  const sessionId = normalizeMiniProgramScene(generateSessionId())
  if (!sessionId) {
    return buildErrorResult('会话创建失败', 'SESSION_CORRUPTED')
  }

  const now = Date.now()
  const expiresAt = now + LOGIN_SESSION_TTL_MS

  await db.collection('login_sessions').add({
    data: {
      _id: sessionId,
      status: 'pending',
      type: 'admin_bind',
      admin_user_id: data.id,
      admin_username: adminRes.data.username || '',
      openid: '',
      qr_source: 'miniprogram',
      created_at: now,
      expires_at: expiresAt,
      tenant_scope: DEFAULT_TENANT_SCOPE,
      session_expire_at: expiresAt
    }
  })

  await writeAdminAuditLog(
    {
      admin_user_id: adminRes.data._id,
      username: adminRes.data.username,
      role: normalizeAdminRole(adminRes.data.role, ''),
      tenant_scope: DEFAULT_TENANT_SCOPE
    },
    'admin.bind_qr.create',
    {
      targetType: 'login_session',
      targetId: sessionId,
      status: 'success',
      message: '管理员微信绑定二维码创建',
      changes: {
        admin_user_id: data.id,
        admin_username: adminRes.data.username
      }
    }
  )

  const qrCodeBase64 = await createMiniProgramLoginQrCode(sessionId)
  if (!qrCodeBase64) {
    await db.collection('login_sessions').doc(sessionId).update({
      data: {
        status: 'expired',
        reject_reason: '小程序码生成失败'
      }
    })
    return buildErrorResult('小程序码生成失败，请检查微信 AppSecret 或云调用权限配置', 'SESSION_CORRUPTED')
  }

  await writeAdminAuditLog({
    admin_user_id: adminRes.data._id,
    username: adminRes.data.username,
    role: adminRes.data.role,
    tenant_scope: DEFAULT_TENANT_SCOPE
  }, 'admin.bind_qr_create', {
    targetType: 'admin_user',
    targetId: adminRes.data._id,
    status: 'success',
    message: '管理员微信绑定二维码生成'
  })

  return buildSuccessResult(buildScanSessionResponse(sessionId, {
    status: 'pending',
    type: 'admin_bind',
    username: adminRes.data.username || '',
    expires_at: expiresAt,
    qr_code_base64: qrCodeBase64,
    qr_code_type: 'miniprogram',
    admin_user_id: data.id,
    message: '请使用微信扫码完成绑定确认'
  }))
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

async function createAppointmentQrCode(data = {}) {
  const scene = String(data.scene || '').trim()
  const appointmentId = String(data.appointment_id || '').trim()

  if (!/^\d{6}$/.test(scene)) {
    return buildErrorResult('核销码格式异常', 'SESSION_CORRUPTED')
  }

  const safeAppointmentId = /^[a-zA-Z0-9_-]{1,64}$/.test(appointmentId)
    ? appointmentId
    : scene

  try {
    const accessToken = await getWechatAccessToken()
    const codeUrl = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`
    const result = await requestWechatJson(codeUrl, 'POST', {
      scene,
      page: 'pages/tech-home/tech-home',
      check_path: false,
      env_version: WECHAT_MINIPROGRAM_QR_ENV_VERSION,
      width: 280
    })

    if (!result || !result.body || !result.body.length) {
      throw new Error('小程序码返回为空')
    }

    const uploadRes = await cloud.uploadFile({
      cloudPath: `qrcodes/${safeAppointmentId}-${scene}.jpg`,
      fileContent: result.body
    })

    return buildSuccessResult({ file_id: uploadRes.fileID })
  } catch (err) {
    console.error('生成预约小程序码失败:', err)
    return buildErrorResult('二维码生成失败：' + (err.message || '未知错误'), 'SESSION_CORRUPTED')
  }
}

async function confirmLoginSession(data) {
  const sessionId = getScanSessionIdFromRequest(data)
  if (!sessionId) {
    return buildErrorResult('会话标识不合法', 'SESSION_CORRUPTED')
  }
  const now = Date.now()

  const markRejected = async (reason, status = 'rejected') => {
    try {
      await db.collection('login_sessions').doc(sessionId).update({
        data: {
          status,
          reject_reason: reason,
          rejected_at: now,
          updated_at: now
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
    return buildErrorResult('无法获取用户身份', 'SESSION_CORRUPTED')
  }

  try {
    const session = await db.collection('login_sessions').doc(sessionId).get()
    const sessionData = session.data

    if (!sessionData) {
      await markRejected('会话不存在')
      return buildErrorResult('登录会话不存在', 'SESSION_CORRUPTED')
    }

    if (sessionData.status !== 'pending') {
      await markRejected('会话已使用或过期', sessionData.status || 'rejected')
      return buildErrorResult('该登录会话已使用或过期', 'SESSION_CORRUPTED')
    }

    if (Date.now() > Number(sessionData.session_expire_at || sessionData.expires_at || 0)) {
      await markRejected('登录会话已过期')
      await db.collection('login_sessions').doc(sessionId).update({
        data: {
          status: 'expired',
          reject_reason: '登录会话已过期',
          expired_at: now,
          updated_at: Date.now()
        }
      })
      return buildErrorResult('登录会话已过期', 'SESSION_CORRUPTED')
    }

    if (sessionData.type === 'admin_bind') {
      return await confirmAdminBindSession(sessionId, sessionData, openid, markRejected)
    }

    return await confirmAdminLoginSession(sessionId, openid, markRejected)
  } catch (err) {
    await markRejected('确认失败：' + err.message)
    return buildErrorResult('确认失败：' + err.message, 'SESSION_CORRUPTED')
  }
}

async function confirmAdminLoginSession(sessionId, openid, markRejected) {
  let adminUser
  let adminRole = ''

  try {
    const adminUserRes = await db.collection('admin_users')
      .where({ openid, status: 'active' })
      .get()

    if (!adminUserRes.data || adminUserRes.data.length === 0) {
      await markRejected('该微信未绑定或账号已停用')
      return buildErrorResult('无权限访问管理后台，请先在管理员账号中绑定微信', 'SESSION_CORRUPTED')
    }
    adminUser = adminUserRes.data[0]
    adminRole = normalizeAdminRole(adminUser.role, '')
    if (!adminRole) {
      await markRejected('管理员角色配置异常')
      return buildErrorResult('该管理员角色配置异常', 'ROLE_MISMATCH')
    }
  } catch (err) {
    await markRejected('未查询到管理员绑定配置')
    return buildErrorResult('无权限访问管理后台，请先在管理员账号中绑定微信', 'SESSION_CORRUPTED')
  }

  await db.collection('login_sessions').doc(sessionId).update({
    data: {
      status: 'confirmed',
      type: 'admin_login',
      openid,
      admin_user_id: adminUser._id,
      admin_username: adminUser.username || '',
      admin_role: adminRole,
      admin_permissions: getRolePermissions(adminRole),
      confirmed_at: Date.now(),
      updated_at: Date.now()
    }
  })

  return buildSuccessResult({
    message: '确认登录成功',
    type: 'admin_login',
    status: 'confirmed',
    session_id: sessionId,
    admin_username: adminUser.username || '',
    admin_user_id: adminUser._id,
    role: adminRole,
    permissions: getRolePermissions(adminRole),
    admin_permissions: getRolePermissions(adminRole),
    tenant_scope: DEFAULT_TENANT_SCOPE
  })
}

async function confirmAdminBindSession(sessionId, session, openid, markRejected) {
  if (!session.admin_user_id) {
    await markRejected('绑定会话缺少管理员账号')
    return buildErrorResult('绑定会话异常，请重新生成二维码', 'SESSION_CORRUPTED')
  }

  const targetRes = await db.collection('admin_users').doc(session.admin_user_id).get()
  if (!targetRes.data) {
    await markRejected('管理员账号不存在')
    return buildErrorResult('管理员账号不存在', 'SESSION_CORRUPTED')
  }

  if (targetRes.data.status && targetRes.data.status !== 'active') {
    await markRejected('管理员账号已停用')
    return buildErrorResult('管理员账号已停用，不能绑定微信', 'SESSION_CORRUPTED')
  }

  const adminRole = normalizeAdminRole(targetRes.data.role, '')
  if (!adminRole) {
    await markRejected('管理员角色配置异常')
    return buildErrorResult('该管理员角色配置异常', 'ROLE_MISMATCH')
  }

  const existing = await db.collection('admin_users')
    .where({
      openid,
      _id: _.neq(session.admin_user_id)
    })
    .get()

  if (existing.data.length > 0) {
    await markRejected('该微信已绑定其他管理员账号')
    return buildErrorResult('该微信已绑定其他管理员账号，请先解绑后重试', 'SESSION_CORRUPTED')
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
      admin_role: adminRole,
      admin_permissions: getRolePermissions(adminRole),
      confirmed_at: Date.now(),
      updated_at: Date.now()
    }
  })

  await writeAdminAuditLog({
    admin_user_id: session.admin_user_id,
    username: targetRes.data.username,
    role: adminRole,
    tenant_scope: DEFAULT_TENANT_SCOPE
  }, 'admin.bind_wechat', {
    targetType: 'admin_user',
    targetId: session.admin_user_id,
    status: 'success',
    message: '管理员微信绑定成功'
  })

  return buildSuccessResult({
    message: '微信绑定成功',
    type: 'admin_bind',
    status: 'confirmed',
    session_id: sessionId,
    admin_user_id: session.admin_user_id
  })
}

async function checkLoginSession(data) {
  const sessionId = getScanSessionIdFromRequest(data)
  if (!sessionId) {
    return buildErrorResult('会话标识不合法', 'SESSION_CORRUPTED')
  }

  const now = Date.now()

  try {
    const session = await db.collection('login_sessions').doc(sessionId).get()
    const sessionData = session.data

    if (!sessionData) {
      return buildErrorResult('会话不存在', 'SESSION_CORRUPTED')
    }

    const sessionExpireAt = Number(sessionData.session_expire_at || sessionData.expires_at || 0)

    if (sessionData.status === 'logged_in' && (!sessionExpireAt || now > sessionExpireAt)) {
      await db.collection('login_sessions').doc(sessionId).update({
        data: {
          status: 'expired',
          reject_reason: '登录会话已过期',
          expired_at: now,
          updated_at: now
        }
      })
      return buildSuccessResult(buildScanSessionResponse(sessionId, {
        status: 'expired',
        type: normalizeLoginSessionType(sessionData.type),
        session_expire_at: sessionExpireAt,
        reason: sessionData.reject_reason || '',
        reject_reason: sessionData.reject_reason || ''
      }))
    }

    if (Date.now() > sessionExpireAt && sessionData.status !== 'logged_in') {
      await db.collection('login_sessions').doc(sessionId).update({
        data: {
          status: 'expired',
          reject_reason: '登录会话已过期',
          expired_at: now,
          updated_at: now
        }
      })
      return buildSuccessResult(buildScanSessionResponse(sessionId, {
        status: 'expired',
        type: normalizeLoginSessionType(sessionData.type),
        session_expire_at: sessionExpireAt,
        reason: sessionData.reject_reason || '',
        reject_reason: sessionData.reject_reason || ''
      }))
    }

    return buildSuccessResult(buildScanSessionResponse(sessionId, {
      status: sessionData.status,
      status_text: sessionData.status,
      type: normalizeLoginSessionType(sessionData.type),
      token: sessionData.status === 'logged_in' ? (sessionData.admin_token || '') : '',
      admin_user_id: sessionData.admin_user_id || '',
      admin_id: sessionData.admin_user_id || '',
      admin_username: sessionData.admin_username || '',
      role: normalizeAdminRole(sessionData.admin_role || sessionData.role || '', ''),
      tenant_scope: sessionData.tenant_scope || DEFAULT_TENANT_SCOPE,
      admin_permissions: sessionData.admin_permissions || [],
      permissions: sessionData.admin_permissions || ((sessionData.admin_role || sessionData.role)
        ? getRolePermissions(normalizeAdminRole(sessionData.admin_role || sessionData.role || '', ''))
        : []),
      reason: sessionData.reject_reason || '',
      reject_reason: sessionData.reject_reason || '',
      session_expire_at: sessionExpireAt,
      session_id: sessionId
    }))
  } catch (err) {
    return buildErrorResult('查询失败：' + err.message, 'SESSION_CORRUPTED')
  }
}

async function scanLogin(data) {
  const sessionId = getScanSessionIdFromRequest(data)
  if (!sessionId) {
    return buildErrorResult('会话标识不合法', 'SESSION_CORRUPTED')
  }

  try {
    const sessionRes = await db.collection('login_sessions').doc(sessionId).get()
    const session = sessionRes.data
    const now = Date.now()
    const sessionExpireAt = Number(session && (session.session_expire_at || session.expires_at || 0))

    if (!session) {
      return buildErrorResult('会话不存在', 'SESSION_CORRUPTED')
    }

    if (session.status === 'rejected') {
      return buildErrorResult('会话已被拒绝', 'SESSION_CORRUPTED')
    }

    if (session.status === 'logged_in' && (!sessionExpireAt || now > sessionExpireAt)) {
      await db.collection('login_sessions').doc(sessionId).update({
        data: {
          status: 'expired',
          reject_reason: '登录会话已过期',
          expired_at: now,
          updated_at: now
        }
      })
      return buildErrorResult('登录会话已过期', 'SESSION_CORRUPTED')
    }

    if (session.status === 'logged_in' && session.admin_token) {
      const sessionRole = normalizeAdminRole(session.admin_role || session.role || '', '')
      if (!sessionRole) {
        return buildErrorResult('登录会话角色异常', 'ROLE_MISMATCH')
      }

      return buildSuccessResult({
        status: 'logged_in',
        session_id: sessionId,
        type: 'admin_login',
        token: session.admin_token,
        username: session.admin_username || '',
        role: sessionRole,
        permissions: getRolePermissions(sessionRole),
        admin_permissions: getRolePermissions(sessionRole),
        tenant_scope: session.tenant_scope || DEFAULT_TENANT_SCOPE,
        session_expire_at: sessionExpireAt,
        expires_at: sessionExpireAt,
        admin_id: session.admin_user_id || '',
        admin_user_id: session.admin_user_id || ''
      })
    }

    if (session.type && session.type !== 'admin_login') {
      return buildErrorResult('该二维码不是登录二维码，请刷新后重试', 'SESSION_CORRUPTED')
    }

    if (session.status !== 'confirmed') {
      return buildErrorResult('会话未确认或已过期', 'SESSION_CORRUPTED')
    }

    if (!sessionExpireAt || Date.now() > sessionExpireAt) {
      await db.collection('login_sessions').doc(sessionId).update({
        data: {
          status: 'expired',
          reject_reason: '登录会话已过期',
          expired_at: Date.now(),
          updated_at: Date.now()
        }
      })
      return buildErrorResult('会话已过期', 'SESSION_CORRUPTED')
    }

    const adminRes = await db.collection('admin_users')
      .where({ openid: session.openid })
      .limit(1)
      .get()

    if (!adminRes.data || adminRes.data.length === 0) {
      return buildErrorResult('该微信未绑定管理员账号', 'SESSION_CORRUPTED')
    }

    const adminUser = adminRes.data[0]
    if (adminUser.status && adminUser.status !== 'active') {
      return buildErrorResult('管理员账号已停用', 'SESSION_CORRUPTED')
    }

    const role = normalizeAdminRole(adminUser.role, '')
    if (!role) {
      return buildErrorResult('管理员角色配置异常', 'ROLE_MISMATCH')
    }

    const token = await createAdminSession({
      admin_user_id: adminUser._id,
      username: adminUser.username || '',
      role,
      openid: adminUser.openid || session.openid,
      login_method: 'scan'
    })

    const loginSessionExpireAt = Date.now() + ADMIN_SESSION_TTL_MS
    await db.collection('login_sessions').doc(sessionId).update({
      data: {
        status: 'logged_in',
        admin_token: token,
        admin_username: adminUser.username || '',
        admin_role: role,
        admin_user_id: adminUser._id,
        admin_openid: adminUser.openid || session.openid,
        admin_permissions: getRolePermissions(role),
        tenant_scope: DEFAULT_TENANT_SCOPE,
        session_expire_at: loginSessionExpireAt,
        logged_in_at: Date.now(),
        updated_at: Date.now()
      }
    })

    await writeAdminAuditLog({
      admin_user_id: adminUser._id,
      username: adminUser.username,
      role,
      tenant_scope: DEFAULT_TENANT_SCOPE
    }, 'admin.login.scan', {
      targetType: 'admin_user',
      targetId: adminUser._id,
      status: 'success',
      message: '扫码登录成功'
    })

      return buildSuccessResult({
        message: '扫码登录成功',
        status: 'logged_in',
        session_id: sessionId,
        type: 'admin_login',
        session_expire_at: loginSessionExpireAt,
        expires_at: loginSessionExpireAt,
        token,
        username: adminUser.username || '',
        role,
        permissions: getRolePermissions(role),
        admin_permissions: getRolePermissions(role),
        admin_id: adminUser._id,
        admin_user_id: adminUser._id,
        tenant_scope: DEFAULT_TENANT_SCOPE
      })
  } catch (err) {
    return buildErrorResult('登录失败：' + err.message, 'SESSION_CORRUPTED')
  }
}

// ==================== 管理员账号管理 ====================

async function getCurrentAdmin(adminAuth = {}) {
  if (!adminAuth || !adminAuth.admin_user_id) {
    return buildErrorResult('身份验证失败，请重新登录', 'TOKEN_EXPIRED')
  }

  const session = adminAuth
  return buildSuccessResult({
    username: session.username || '管理员',
    role: session.role,
    openid: session.openid || '',
    permissions: session.permissions || [],
    admin_permissions: session.permissions || [],
    admin_id: session.admin_user_id,
    tenant_scope: session.tenant_scope || DEFAULT_TENANT_SCOPE,
    session_expire_at: session.session_expire_at || 0,
    last_login_at: session.last_login_at || 0
  })
}

async function getAdminAuditLogs(adminAuth = {}, data = {}) {
  if (!adminAuth || adminAuth.role !== 'super_admin') {
    return buildErrorResult('当前账号无权限访问审计日志', 'INSUFFICIENT_PERMISSION')
  }

  const page = normalizePagination(data && data.page, 1, 200)
  const pageSize = normalizePagination(data && data.page_size, 20, 200)

  const filters = {}
  if (data && data.admin_user_id) {
    filters.admin_user_id = data.admin_user_id
  }
  if (data && data.action) {
    filters.action = data.action
  }
  if (data && data.target_type) {
    filters.target_type = data.target_type
  }
  if (data && data.target_id) {
    filters.target_id = data.target_id
  }

  let query = db.collection('admin_audit_logs')
  let countQuery = db.collection('admin_audit_logs')
  Object.keys(filters).forEach((key) => {
    query = query.where({ [key]: filters[key] })
    countQuery = countQuery.where({ [key]: filters[key] })
  })

  const countRes = await countQuery.count()
  const total = Number(countRes.total || 0)

  const listRes = await query
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  return buildSuccessResult({
    list: listRes.data || [],
    total,
    page,
    page_size: pageSize
  })
}

async function getAdminUsers(adminAuth = {}) {
  const res = await db.collection('admin_users')
    .where({ status: _.neq('deleted') })
    .orderBy('created_at', 'desc')
    .get()

  return buildSuccessResult(
    res.data
      .map(sanitizeAdminUser)
      .map(user => ({
        ...user,
        last_login_at: user.last_login_at || 0
      }))
  )
}

async function addAdminUser(adminAuth = {}, data = {}) {
  if (!data || typeof data !== 'object') {
    return buildErrorResult('参数无效', 'SESSION_CORRUPTED')
  }

  const username = (data.username || '').trim()
  const password = (data.password || '').trim()
  const role = normalizeAdminRole(typeof data.role === 'string' ? data.role : '', '')
  const openid = (data.openid || '').trim()

  if (!username) {
    return buildErrorResult('请输入登录账号', 'SESSION_CORRUPTED')
  }
  if (username.length > 64) {
    return buildErrorResult('管理员账号长度不能超过64', 'SESSION_CORRUPTED')
  }
  if (!password) {
    return buildErrorResult('请输入登录密码', 'SESSION_CORRUPTED')
  }
  if (password.length < 6) {
    return buildErrorResult('密码长度不能少于6位', 'SESSION_CORRUPTED')
  }
  if (!role) {
    return buildErrorResult('管理员角色无效', 'SESSION_CORRUPTED')
  }

  const existing = await db.collection('admin_users').where({ username }).get()
  if (existing.data.length > 0) {
    return buildErrorResult('账号名称已存在', 'SESSION_CORRUPTED')
  }

  if (openid) {
    const existingOpenid = await db.collection('admin_users').where({ openid }).get()
    if (existingOpenid.data.length > 0) {
      return buildErrorResult('该微信已绑定其他管理员账号', 'SESSION_CORRUPTED')
    }
  }

  const res = await db.collection('admin_users').add({
    data: {
      username,
      password_hash: hashAdminPassword(password),
      openid,
      role,
      name: (data.name || '').trim(),
      remark: (data.remark || '').trim(),
      status: 'active',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  await writeAdminAuditLog(adminAuth, 'admin.add', {
    targetType: 'admin_user',
    targetId: res._id,
    status: 'success',
    message: '新增管理员账号'
  })

  return buildSuccessResult({ message: '添加成功', _id: res._id })
}

async function updateAdminUser(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少 id', 'SESSION_CORRUPTED')
  }

  const updateData = {}
  const sessionInvalidateReasons = []

  if (typeof data.username === 'string') {
    const username = data.username.trim()
    if (!username) {
      return buildErrorResult('登录账号不能为空', 'SESSION_CORRUPTED')
    }
    if (username.length > 64) {
      return buildErrorResult('管理员账号长度不能超过64', 'SESSION_CORRUPTED')
    }

    const existing = await db.collection('admin_users')
      .where({
        username,
        _id: _.neq(data.id)
      })
      .get()

    if (existing.data.length > 0) {
      return buildErrorResult('账号名称已存在', 'SESSION_CORRUPTED')
    }

    updateData.username = username
  }

  if (typeof data.password === 'string' && data.password.trim()) {
    const password = data.password.trim()
    if (password.length < 6) {
      return buildErrorResult('密码长度不能少于6位', 'SESSION_CORRUPTED')
    }
    updateData.password_hash = hashAdminPassword(password)
  }

  if (typeof data.role === 'string') {
    const role = normalizeAdminRole(data.role, '')
    if (!role) {
      return buildErrorResult('管理员角色无效', 'SESSION_CORRUPTED')
    }
    if (adminAuth.admin_user_id === data.id && role !== adminAuth.role) {
      return buildErrorResult('不能直接修改当前登录账号的角色', 'SESSION_CORRUPTED')
    }
    updateData.role = role
    sessionInvalidateReasons.push('角色已变更')
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
        return buildErrorResult('该微信已绑定其他管理员账号', 'SESSION_CORRUPTED')
      }
    }
    updateData.openid = openid
    sessionInvalidateReasons.push('微信绑定信息已变更')
  }

  if (typeof data.name === 'string') {
    if (data.name.trim().length > 64) {
      return buildErrorResult('姓名长度不能超过64', 'SESSION_CORRUPTED')
    }
    updateData.name = data.name.trim()
  }

  if (typeof data.remark === 'string') {
    if (data.remark.trim().length > 300) {
      return buildErrorResult('备注长度不能超过300', 'SESSION_CORRUPTED')
    }
    updateData.remark = data.remark.trim()
  }

  if (typeof data.status === 'string' && ['active', 'inactive'].includes(data.status)) {
    if (adminAuth.admin_user_id === data.id && data.status !== 'active') {
      return buildErrorResult('不能停用当前登录账号', 'SESSION_CORRUPTED')
    }
    updateData.status = data.status
    sessionInvalidateReasons.push('账号状态已变更')
  } else if (typeof data.status === 'string') {
    return buildErrorResult('管理员状态不合法', 'SESSION_CORRUPTED')
  }

  if (Object.keys(updateData).length === 0) {
    return buildSuccessResult({ message: '未修改任何字段' })
  }

  updateData.updated_at = db.serverDate()
  await db.collection('admin_users').doc(data.id).update({
    data: updateData
  })

  if (sessionInvalidateReasons.length > 0) {
    const invalidated = await invalidateAdminSessionsByUser(data.id, sessionInvalidateReasons[0])
    if (invalidated > 0) {
      writeAdminAuditLog(adminAuth, 'admin.invalidate_session', {
        targetType: 'admin_user',
        targetId: data.id,
        status: 'success',
        changes: {
          reasons: sessionInvalidateReasons,
          count: invalidated
        },
        message: '管理员关键字段变更，已失效历史会话'
      }).catch(() => {})
    }
  }

  await writeAdminAuditLog(adminAuth, 'admin.update', {
    targetType: 'admin_user',
    targetId: data.id,
    changes: updateData,
    status: 'success',
    message: '更新管理员账号'
  })

  return buildSuccessResult({ message: '更新成功' })
}

async function removeAdminUser(adminAuth = {}, data = {}) {
  if (!data || !data.id) {
    return buildErrorResult('缺少 id', 'SESSION_CORRUPTED')
  }

  if (adminAuth.admin_user_id === data.id) {
    return buildErrorResult('不能删除当前登录账号', 'SESSION_CORRUPTED')
  }

  const target = await db.collection('admin_users').doc(data.id).get()
  if (!target.data) {
    return buildErrorResult('管理员账号不存在', 'SESSION_CORRUPTED')
  }

  if (target.data.role === 'super_admin' && target.data.status !== 'deleted') {
    const activeSuperAdminRes = await db.collection('admin_users')
      .where({ role: 'super_admin', status: 'active' })
      .count()

    if ((activeSuperAdminRes.total || 0) <= 1) {
      return buildErrorResult('不能删除唯一的超级管理员', 'SESSION_CORRUPTED')
    }
  }

  await db.collection('admin_users')
    .doc(data.id)
    .update({
      data: {
        status: 'deleted',
        deleted_at: db.serverDate(),
        deleted_by: adminAuth.admin_user_id || '',
        openid: '',
        updated_at: db.serverDate()
      }
    })

  await invalidateAdminSessionsByUser(data.id, '管理员账号已被删除')
  writeAdminAuditLog(adminAuth, 'admin.invalidate_session', {
    targetType: 'admin_user',
    targetId: data.id,
    status: 'success',
    message: '管理员账号已删除，已失效历史会话'
  }).catch(() => {})

  await writeAdminAuditLog(adminAuth, 'admin.remove', {
    targetType: 'admin_user',
    targetId: data.id,
    status: 'success',
    message: '删除管理员账号'
  })

  return buildSuccessResult({ message: '删除成功' })
}
