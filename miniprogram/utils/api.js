// 云函数调用封装
const callFunction = (name, data = {}) => {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: res => {
        if (res.result && res.result.code === 0) {
          resolve(res.result.data)
        } else {
          reject(res.result || { message: '请求失败' })
        }
      },
      fail: err => {
        console.error(`调用云函数 ${name} 失败:`, err)
        reject(err)
      }
    })
  })
}

// 用户登录
const login = (userInfo) => callFunction('login', userInfo)

// 获取服务列表
const getServices = () => callFunction('getServices')

// 获取可用时段
const getAvailableSlots = (data) => callFunction('getAvailableSlots', data)

// 创建预约
const createAppointment = (data) => callFunction('createAppointment', data)

// 取消预约
const cancelAppointment = (id) => callFunction('cancelAppointment', { id })

// 核销预约
const verifyAppointment = (id) => callFunction('verifyAppointment', { id })

// 获取我的预约列表
const getMyAppointments = (data) => callFunction('getMyAppointments', data)

// 获取技师预约列表
const getTechAppointments = (data) => callFunction('getAppointments', data)

// 获取文章列表
const getArticles = () => callFunction('getArticles')

// 获取文章详情
const getArticleDetail = (id) => callFunction('getArticleDetail', { id })

// 获取营业配置
const getConfig = () => callFunction('admin', { action: 'getConfig' })

const getHolidays = (data) => callFunction('admin', { action: 'getHolidays', data })

module.exports = {
  callFunction,
  login,
  getServices,
  getAvailableSlots,
  createAppointment,
  cancelAppointment,
  verifyAppointment,
  getMyAppointments,
  getTechAppointments,
  getArticles,
  getArticleDetail,
  getConfig,
  getHolidays
}
