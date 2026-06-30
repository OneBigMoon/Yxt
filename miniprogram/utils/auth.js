const app = getApp()
const { callFunction } = require('./api')

const syncUserToGlobal = (data) => {
  if (!data) {
    return null
  }

  app.globalData.userInfo = data
  app.globalData.role = data.role
  app.globalData.openid = data.openid
  wx.setStorageSync('userInfo', data)

  return data
}

const fullLogin = async (userInfo, phoneCode) => {
  const user = await callFunction('login', {
    type: 'login',
    userInfo,
    phoneCode
  })

  if (!user) {
    throw new Error('登录失败')
  }
  return syncUserToGlobal(user)
}

const updateProfile = async (nickName, avatarUrl) => {
  const user = await callFunction('login', {
    type: 'updateProfile',
    nickName,
    avatarUrl
  })

  if (!user) {
    throw new Error('更新失败')
  }
  return syncUserToGlobal(user)
}

const checkBlacklist = async () => {
  const localUser = wx.getStorageSync('userInfo')
  if (!localUser || !localUser.openid) {
    return false
  }

  const latest = await callFunction('login', { type: 'login' })
  return Boolean(latest && latest.is_blacklisted)
}

const checkAuth = () => {
  return new Promise((resolve) => {
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo) {
      app.globalData.userInfo = userInfo
      app.globalData.role = userInfo.role
      app.globalData.openid = userInfo.openid
      resolve(userInfo)
    } else {
      resolve(null)
    }
  })
}

const logout = () => {
  app.globalData.userInfo = null
  app.globalData.role = null
  app.globalData.openid = null
  wx.removeStorageSync('userInfo')
}

module.exports = {
  fullLogin,
  updateProfile,
  checkBlacklist,
  checkAuth,
  logout
}
