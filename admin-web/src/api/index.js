import app from './cloudbase'

let loginPromise = null
function ensureLogin() {
  if (!loginPromise) {
    const auth = app.auth()
    loginPromise = (async () => {
      const hasLoginState = await auth.hasLoginState()
      if (hasLoginState) {
        return
      }

      return auth.signInAnonymously().catch(err => {
        console.error('匿名登录失败:', err)
        loginPromise = null
        throw new Error('云开发匿名登录失败，请在云开发控制台开启匿名登录，并确认当前域名已允许访问')
      })
    })()
  }
  return loginPromise
}

async function callAdmin(action, data = {}) {
  await ensureLogin()
  const adminPassword = sessionStorage.getItem('admin_password') || ''
  const adminToken = sessionStorage.getItem('admin_token') || ''
  try {
    const res = await app.callFunction({
      name: 'admin',
      data: { action, data, admin_password: adminPassword, admin_token: adminToken }
    })
    if (!res || !res.result) {
      throw new Error('云函数返回异常')
    }
    if (res.result.code !== 0) {
      throw new Error(res.result.message || '请求失败')
    }
    return res.result.data
  } catch (err) {
    console.error(`调用云函数失败 [${action}]:`, err)
    if (err && err.message && err.message.includes('network request error')) {
      throw new Error('云函数网络请求失败，请确认匿名登录已开启、admin 云函数已部署、当前域名已加入云开发 Web 安全域名')
    }
    throw err
  }
}

export const authApi = {
  passwordLogin(payload) {
    const data = typeof payload === 'string'
      ? { password: payload }
      : (payload || {})
    return callAdmin('verifyAdminPassword', data)
  },
  getCurrent() {
    return callAdmin('getCurrentAdmin')
  }
}

// 预约相关API
export const appointmentApi = {
  getList(params) {
    return callAdmin('getAppointments', params)
  },
  getDetail(id) {
    return callAdmin('getAppointmentDetail', { id })
  }
}

// 客户相关API
export const customerApi = {
  getList(params) {
    return callAdmin('getCustomers', params)
  },
  update(id, data) {
    return callAdmin('updateCustomer', { ...data, id })
  },
  delete(id) {
    return callAdmin('deleteCustomer', { id })
  },
  toggleBlacklist(id, isBlacklisted) {
    return callAdmin('toggleBlacklist', { id, is_blacklisted: isBlacklisted })
  }
}

// 技师相关API
export const technicianApi = {
  getList() {
    return callAdmin('getTechnicians')
  },
  create(data) {
    return callAdmin('createTechnician', data)
  },
  update(id, data) {
    return callAdmin('updateTechnician', { ...data, id })
  },
  toggleStatus(id, status) {
    return callAdmin('toggleTechnicianStatus', { id, status })
  }
}

// 服务相关API
export const serviceApi = {
  getList() {
    return callAdmin('getServices')
  },
  create(data) {
    return callAdmin('createService', data)
  },
  update(id, data) {
    return callAdmin('updateService', { ...data, id })
  }
}

// 营业配置API
export const configApi = {
  get() {
    return callAdmin('getConfig')
  },
  update(data) {
    return callAdmin('updateConfig', data)
  }
}

// 休息管理API
export const restApi = {
  getHolidays(params) {
    return callAdmin('getHolidays', params)
  },
  addHoliday(data) {
    return callAdmin('addHoliday', data)
  },
  deleteHoliday(id) {
    return callAdmin('deleteHoliday', { id })
  },
  getTechDaysOff() {
    return callAdmin('getTechDaysOff')
  },
  addTechDayOff(data) {
    return callAdmin('addTechDayOff', data)
  },
  deleteTechDayOff(id) {
    return callAdmin('deleteTechDayOff', { id })
  },
  importHolidays() {
    return callAdmin('importHolidays')
  }
}

// 提成统计API
export const commissionApi = {
  getList(params) {
    return callAdmin('getCommissions', params)
  },
  getSummary(params) {
    return callAdmin('getCommissionSummary', params)
  }
}

// 文章相关API
export const articleApi = {
  getList() {
    return callAdmin('getArticles')
  },
  create(data) {
    return callAdmin('createArticle', data)
  },
  update(id, data) {
    return callAdmin('updateArticle', { ...data, id })
  },
  toggleStatus(id, status) {
    return callAdmin('toggleArticleStatus', { id, status })
  }
}

// 管理员账号API
export const adminUserApi = {
  getList() {
    return callAdmin('getAdminUsers')
  },
  add(data) {
    return callAdmin('addAdminUser', data)
  },
  update(id, data) {
    return callAdmin('updateAdminUser', { ...data, id })
  },
  resetPassword(id, password) {
    return callAdmin('updateAdminUser', { id, password })
  },
  updateStatus(id, status) {
    return callAdmin('updateAdminUser', { id, status })
  },
  createBindSession(id) {
    return callAdmin('createAdminBindSession', { id })
  },
  checkBindSession(sessionId) {
    return callAdmin('checkLoginSession', { session_id: sessionId })
  },
  remove(id) {
    return callAdmin('removeAdminUser', { id })
  }
}

// 文件上传 — 用云存储替代 Express multer

// 扫码登录API
export const scanLoginApi = {
  // 创建登录会话
  createSession() {
    return callAdmin('createLoginSession', { prefer_miniprogram_qr: true })
  },
  // 轮询检查会话状态
  checkSession(sessionId) {
    return callAdmin('checkLoginSession', { session_id: sessionId })
  },
  // 确认登录后获取后台会话 token
  scanLogin(sessionId) {
    return callAdmin('scanLogin', { session_id: sessionId })
  }
}
export async function uploadFile(file) {
  await ensureLogin()
  const ext = file.name.split('.').pop()
  const cloudPath = `admin-uploads/${Date.now()}.${ext}`
  const result = await app.uploadFile({
    cloudPath,
    filePath: file
  })
  const urlRes = await app.getTempFileURL({
    fileList: [result.fileID]
  })
  return urlRes.fileList[0].tempFileURL
}
