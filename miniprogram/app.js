App({
  globalData: {
    userInfo: null,
    role: null,
    openid: null,
    lastBlacklistCheck: 0
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloud1-4gvszpobf92abfb6',
      traceUser: true
    })
  },

  onShow() {
    this.checkBlacklist()
  },

  // 全局黑名单检查（每5分钟最多检查一次）
  async checkBlacklist() {
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo) return

    const now = Date.now()
    if (now - this.globalData.lastBlacklistCheck < 5 * 60 * 1000) return
    this.globalData.lastBlacklistCheck = now

    try {
      const res = await new Promise((resolve, reject) => {
        wx.cloud.callFunction({
          name: 'login',
          data: { type: 'login' },
          success: res => resolve(res.result),
          fail: err => reject(err)
        })
      })

      if (res && res.code === 0 && res.data && res.data.is_blacklisted) {
        wx.removeStorageSync('userInfo')
        this.globalData.userInfo = null
        this.globalData.role = null
        this.globalData.openid = null

        wx.showModal({
          title: '账号异常',
          content: '您的账号注册信息有误，请联系门店处理',
          showCancel: false,
          confirmText: '知道了',
          success: () => {
            wx.redirectTo({ url: '/pages/login/login' })
          }
        })
      }
    } catch (err) {
      // 检查失败不影响正常使用
    }
  },

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
