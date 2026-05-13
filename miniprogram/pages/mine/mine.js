const { getConfig } = require('../../utils/api')
const { checkAuth, logout } = require('../../utils/auth')

Page({
  data: {
    userInfo: {},
    isLoggedIn: false,
    clinicInfo: {}
  },

  onLoad() {
    this.loadUserInfo()
    this.loadConfig()
  },

  onShow() {
    this.loadUserInfo()
  },

  loadUserInfo() {
    checkAuth().then(userInfo => {
      if (userInfo) {
        let maskedPhone = ''
        if (userInfo.phone && userInfo.phone.length === 11) {
          maskedPhone = userInfo.phone.substring(0, 3) + '****' + userInfo.phone.substring(7)
        } else {
          maskedPhone = userInfo.phone || ''
        }
        this.setData({ userInfo, isLoggedIn: true, maskedPhone })
      } else {
        this.setData({ userInfo: {}, isLoggedIn: false, maskedPhone: '' })
      }
    })
  },

  async loadConfig() {
    try {
      const config = await getConfig()
      this.setData({ clinicInfo: config.store || {} })
    } catch (err) {
      console.error('获取配置失败:', err)
      wx.showToast({ title: '获取门店信息失败', icon: 'none' })
    }
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  goMyAppointments() {
    wx.navigateTo({ url: '/pages/my-appointments/my-appointments' })
  },

  openLocation() {
    const { clinicInfo } = this.data
    if (clinicInfo.latitude && clinicInfo.longitude) {
      wx.openLocation({
        latitude: clinicInfo.latitude,
        longitude: clinicInfo.longitude,
        name: clinicInfo.name,
        address: clinicInfo.address
      })
    } else {
      wx.showToast({ title: '暂无门店位置信息', icon: 'none' })
    }
  },

  callPhone() {
    const { clinicInfo } = this.data
    if (clinicInfo.phone) {
      wx.makePhoneCall({ phoneNumber: clinicInfo.phone })
    } else {
      wx.showToast({ title: '暂无门店电话', icon: 'none' })
    }
  },

  handleLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          logout()
          this.setData({ userInfo: {}, isLoggedIn: false })
          wx.showToast({ title: '已退出登录', icon: 'success' })
        }
      }
    })
  }
})
