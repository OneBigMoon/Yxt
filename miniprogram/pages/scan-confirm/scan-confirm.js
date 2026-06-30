Page({
  data: {
    sessionId: '',
    loading: false,
    confirmed: false,
    errorMessage: '',
    resultMessage: '',
    pageTitle: '正在确认',
    pageDesc: '正在为你完成管理后台登录或微信绑定，请稍候'
  },

  onLoad(options) {
    // 从小程序码参数、普通参数或微信普通链接二维码 q 参数中获取 session_id
    const sessionId = this.getSessionIdFromOptions(options)
    if (!sessionId) {
      wx.showModal({
        title: '错误',
        content: '无效的登录会话',
        showCancel: false,
        success() {
          wx.navigateBack()
        }
      })
      return
    }

    if (!/^[a-z0-9]{32}$/.test(sessionId)) {
      this.setData({
        errorMessage: '二维码参数异常，请联系管理员重新生成'
      })
      return
    }

    this.setData({ sessionId })
    this.onConfirm()
  },

  getSessionIdFromOptions(options = {}) {
    if (options.session_id) {
      return decodeURIComponent(options.session_id)
    }

    if (options.scene) {
      return decodeURIComponent(options.scene)
    }

    if (options.q) {
      return this.getSessionIdFromLink(decodeURIComponent(options.q))
    }

    return ''
  },

  getSessionIdFromLink(link) {
    const match = `${link}`.match(/[?&]session_id=([^&#]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  },

  async onConfirm() {
    if (this.data.loading || this.data.confirmed) {
      return
    }

    if (!this.data.sessionId || this.data.errorMessage) {
      this.setData({ errorMessage: '无效会话，请返回重新扫码' })
      return
    }

    this.setData({ loading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'admin',
        data: {
          action: 'confirmLoginSession',
          data: { session_id: this.data.sessionId }
        }
      })

      if (res.result && res.result.code === 0) {
        const message = (res.result.data && res.result.data.message) || '确认成功'
        this.setData({
          confirmed: true,
          loading: false,
          errorMessage: '',
          resultMessage: message,
          pageTitle: message.includes('绑定') ? '绑定成功' : '确认成功',
          pageDesc: message.includes('绑定')
            ? '当前微信已经成功绑定管理员账号'
            : '管理后台登录已确认'
        })
        wx.showToast({ title: message.length > 7 ? '确认成功' : message, icon: 'success' })
        setTimeout(() => {
          wx.navigateBack()
        }, 2200)
      } else {
        const message = (res.result && res.result.message) || '请重新扫码'
        this.setData({
          loading: false,
          errorMessage: message,
          confirmed: false,
          resultMessage: '',
          pageTitle: '确认失败',
          pageDesc: '请返回管理后台刷新二维码后重试'
        })
        wx.showToast({
          title: message.length > 14 ? '确认失败' : message,
          icon: 'none'
        })
      }
    } catch (err) {
      console.error('确认登录失败:', err)
      this.setData({
        errorMessage: '网络请求失败，请稍后重试',
        confirmed: false,
        resultMessage: '',
        pageTitle: '确认失败',
        pageDesc: '网络请求失败，请稍后重试'
      })
      wx.showToast({ title: '网络请求失败，请稍后重试', icon: 'none' })
      this.setData({ loading: false })
    }
  }
})
