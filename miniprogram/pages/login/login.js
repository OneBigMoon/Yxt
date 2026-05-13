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
      content: '用户协议内容...',
      showCancel: false
    })
  },

  showPrivacy() {
    wx.showModal({
      title: '隐私政策',
      content: '隐私政策内容...',
      showCancel: false
    })
  }
})
