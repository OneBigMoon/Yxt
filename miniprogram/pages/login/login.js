const { fullLogin, checkAuth } = require('../../utils/auth')

Page({
  data: {
    agreed: false,
    loginLoading: false
  },

  onLoad() {
    checkAuth({ refresh: true }).then(userInfo => {
      if (userInfo) {
        this.routeByRole(userInfo.role)
      }
    })
  },

  onAgreementTap() {
    this.setData({ agreed: !this.data.agreed })
  },

  async onGetPhoneNumber(e) {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选同意协议', icon: 'none' })
      return
    }

    if (this.data.loginLoading) {
      return
    }

    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '需要手机号用于预约确认', icon: 'none' })
      return
    }

    this.setData({ loginLoading: true })

    try {
      const result = await fullLogin(null, e.detail.code)

      // 黑名单检查
      if (result.is_blacklisted) {
        this.setData({ loginLoading: false })
        wx.showModal({
          title: '账号异常',
          content: '该账号暂无法预约，请联系门店处理',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }

      const toastTitle = result.role === 'technician'
        ? '技师身份已识别'
        : (result.isNewUser ? '客户档案已建立' : '登录成功')

      wx.showToast({ title: toastTitle, icon: 'success' })
      setTimeout(() => {
        this.routeByRole(result.role)
      }, 1000)
    } catch (err) {
      console.error('登录失败:', err)
      wx.showToast({
        title: err && err.message ? err.message : '登录失败，请重试',
        icon: 'none'
      })
      this.setData({ loginLoading: false })
    }
  },

  routeByRole(role) {
    if (role === 'technician') {
      wx.redirectTo({ url: '/pages/tech-home/tech-home' })
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  showAgreement() {
    wx.showModal({
      title: '用户协议',
      content: '1. 本小程序提供中医门诊预约服务，用户需提供真实个人信息。\n2. 预约成功后请按时到店，如需取消请提前操作。\n3. 爽约3次以上将限制预约功能。\n4. 本协议最终解释权归壹心堂中医门诊所有。',
      showCancel: false
    })
  },

  showPrivacy() {
    wx.showModal({
      title: '隐私政策',
      content: '1. 我们仅收集预约服务所需的必要信息，包括手机号、可选昵称、可选头像和预约记录。\n2. 手机号用于登录识别、预约管理、门店服务联系和订单核销。\n3. 头像和昵称仅用于个人资料展示，您可不填写。\n4. 门店导航仅展示门店位置，不会收集您的实时定位。\n5. 您可联系门店查询、更正或删除个人数据。',
      showCancel: false
    })
  }
})
