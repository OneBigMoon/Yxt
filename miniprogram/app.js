App({
  globalData: {
    userInfo: null,
    role: null, // 'patient' | 'technician'
    openid: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloud1-4gvszpobf92abfb6', // 替换为你的云开发环境ID
      traceUser: true
    })
  },

  // 检查登录状态
  checkLogin() {
    return new Promise((resolve, reject) => {
      const userInfo = wx.getStorageSync('userInfo')
      if (userInfo) {
        this.globalData.userInfo = userInfo
        this.globalData.role = userInfo.role
        this.globalData.openid = userInfo.openid
        resolve(userInfo)
      } else {
        reject('未登录')
      }
    })
  }
})
