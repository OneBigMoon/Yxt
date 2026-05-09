const app = getApp()

export const fullLogin = async (userInfo, phoneCode) => {
  try {
    const result = await wx.cloud.callFunction({
      name: 'login',
      data: {
        type: 'login',
        userInfo,
        phoneCode
      }
    })

    if (result.result && result.result.code === 0) {
      const data = result.result.data
      app.globalData.userInfo = data
      app.globalData.role = data.role
      app.globalData.openid = data.openid
      wx.setStorageSync('userInfo', data)
      return data
    } else {
      throw new Error(result.result?.message || '登录失败')
    }
  } catch (err) {
    throw err
  }
}

export const updateProfile = async (nickName, avatarUrl) => {
  const result = await wx.cloud.callFunction({
    name: 'login',
    data: {
      type: 'updateProfile',
      nickName,
      avatarUrl
    }
  })

  if (result.result && result.result.code === 0) {
    const data = result.result.data
    app.globalData.userInfo = data
    app.globalData.role = data.role
    wx.setStorageSync('userInfo', data)
    return data
  } else {
    throw new Error(result.result?.message || '更新失败')
  }
}

export const checkAuth = () => {
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

export const logout = () => {
  app.globalData.userInfo = null
  app.globalData.role = null
  app.globalData.openid = null
  wx.removeStorageSync('userInfo')
}

export default {
  fullLogin,
  updateProfile,
  checkAuth,
  logout
}
