const { fullLogin, updateProfile, checkAuth } = require('../../utils/auth')

Page({
  data: {
    agreed: false,
    loginLoading: false,
    showProfileForm: false,
    avatarUrl: '',
    nickName: '',
    loggedRole: ''
  },

  onLoad() {
    checkAuth().then(userInfo => {
      if (userInfo) {
        this.routeByRole(userInfo.role)
      }
    })
  },

  onAgreementTap() {
    this.setData({ agreed: !this.data.agreed })
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    this.setData({ avatarUrl })
  },

  onNicknameChange(e) {
    this.setData({ nickName: e.detail.value })
  },

  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '需要授权手机号才能登录', icon: 'none' })
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
          content: '您的账号注册信息有误，请联系门店处理',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }

      if (result.isNewUser && result.role === 'technician') {
        this.setData({ loginLoading: false })
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => {
          this.routeByRole('technician')
        }, 1000)
      } else if (result.isNewUser) {
        this.setData({ loginLoading: false, loggedRole: result.role || 'patient' })
        wx.navigateTo({ url: '/pages/profile/profile' })
      } else {
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => {
          this.routeByRole(result.role)
        }, 1000)
      }
    } catch (err) {
      console.error('登录失败:', err)
      wx.showToast({ title: '登录失败，请重试', icon: 'none' })
      this.setData({ loginLoading: false })
    }
  },

  async onCompleteProfile() {
    this.setData({ loginLoading: true })

    try {
      await updateProfile(
        this.data.nickName || '微信用户',
        this.data.avatarUrl || ''
      )

      wx.showToast({ title: '注册成功', icon: 'success' })
      setTimeout(() => {
        this.routeByRole(this.data.loggedRole || 'patient')
      }, 1000)
    } catch (err) {
      console.error('注册失败:', err)
      wx.showToast({ title: '注册失败，请重试', icon: 'none' })
    } finally {
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
      content: '1. 我们仅收集预约服务所需的必要信息（手机号、昵称）。\n2. 您的个人信息仅用于预约管理和门店服务，不会提供给第三方。\n3. 您可随时联系我们删除您的个人数据。\n4. 如有疑问请联系门店客服。',
      showCancel: false
    })
  }
})
