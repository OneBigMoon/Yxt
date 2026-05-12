import app from './cloudbase'

let loginPromise = null
function ensureLogin() {
  if (!loginPromise) {
    const auth = app.auth()
    loginPromise = auth.hasLoginState()
      ? Promise.resolve()
      : auth.signInAnonymously().catch(err => {
          console.error('匿名登录失败:', err)
          loginPromise = null
          throw new Error('云开发登录失败，请在云开发控制台开启匿名登录')
        })
  }
  return loginPromise
}

async function callAdmin(action, data = {}) {
  await ensureLogin()
  try {
    const res = await app.callFunction({
      name: 'admin',
      data: { action, data }
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
    throw err
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

// 文件上传 — 用云存储替代 Express multer
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
