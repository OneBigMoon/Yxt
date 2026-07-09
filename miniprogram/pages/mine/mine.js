const { getConfig } = require('../../utils/api')
const { checkAuth, logout, checkBlacklist } = require('../../utils/auth')

Page({
  data: {
    userInfo: {},
    isLoggedIn: false,
    clinicInfo: {},
    businessHourLines: [],
    maskedPhone: '',
    userDisplayName: '',
    facilities: []
  },

  onLoad() {
    this.loadConfig()
  },

  onShow() {
    this.loadUserInfo()
  },

  loadUserInfo() {
    checkAuth({ refresh: true }).then(userInfo => {
      if (userInfo) {
        const maskedPhone = this.maskPhone(userInfo.phone)
        const hasCustomName = userInfo.nick_name && userInfo.nick_name !== '微信用户'
        const userDisplayName = hasCustomName ? userInfo.nick_name : (maskedPhone || '已登录')
        this.setData({ userInfo, isLoggedIn: true, maskedPhone, userDisplayName })

        // 实时检查黑名单状态
        this.checkBlacklistStatus()
      } else {
        this.setData({ userInfo: {}, isLoggedIn: false, maskedPhone: '', userDisplayName: '' })
      }
    })
  },

  maskPhone(phone) {
    if (phone && phone.length === 11) {
      return phone.substring(0, 3) + '****' + phone.substring(7)
    }
    return phone || ''
  },

  async checkBlacklistStatus() {
    try {
      const isBlacklisted = await checkBlacklist()
      if (isBlacklisted) {
        wx.showModal({
          title: '账号异常',
          content: '该账号暂无法预约，请联系门店处理',
          showCancel: false,
          confirmText: '知道了',
          success: () => {
            logout()
            this.setData({ userInfo: {}, isLoggedIn: false, maskedPhone: '', userDisplayName: '' })
          }
        })
      }
    } catch (err) {
      // 检查失败不影响正常使用
    }
  },

  async loadConfig() {
    try {
      const config = await getConfig()
      const storeInfo = config.store || {}
      const businessHourLines = []
      if (config.schedule) {
        const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
        const periods = []
        for (let day = 1; day <= 7; day++) {
          const hours = config.schedule[day]
          if (Array.isArray(hours) && hours.length > 0) {
            const times = hours.map(p => `${p.start}-${p.end}`).join('、')
            periods.push(`${dayNames[day]} ${times}`)
            businessHourLines.push({ day: dayNames[day], time: times })
          }
        }
        if (periods.length > 0) {
          storeInfo.business_hours = periods.join('；')
        }
      }
      this.setData({
        clinicInfo: storeInfo,
        businessHourLines,
        facilities: this.normalizeFacilities(config.facilities)
      })
    } catch (err) {
      console.error('获取配置失败:', err)
      wx.showToast({ title: '获取门店信息失败', icon: 'none' })
    }
  },

  normalizeFacilities(items) {
    const fallback = [
      { name: '门口停车', icon: 'logistics', enabled: true, sort: 1 },
      { name: '等候座椅', icon: 'friends-o', enabled: true, sort: 2 },
      { name: '可拨门店', icon: 'phone-o', enabled: true, sort: 3 }
    ]
    const source = Array.isArray(items) ? items : fallback
    return source
      .filter(item => item && item.enabled !== false && item.name)
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      .map(item => ({
        name: String(item.name || '').trim(),
        icon: String(item.icon || 'shop-o').trim()
      }))
      .slice(0, 6)
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  handleUserTap() {
    if (this.data.isLoggedIn) {
      this.goProfile()
    } else {
      this.goLogin()
    }
  },

  goProfile() {
    if (!this.data.isLoggedIn) {
      this.goLogin()
      return
    }
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goBooking() {
    wx.switchTab({ url: '/pages/booking/booking' })
  },

  goMyAppointments() {
    wx.navigateTo({ url: '/pages/my-appointments/my-appointments' })
  },

  openLocation() {
    const { clinicInfo } = this.data
    const configuredLatitude = Number(clinicInfo.latitude)
    const configuredLongitude = Number(clinicInfo.longitude)
    const hasConfiguredLocation = (
      Number.isFinite(configuredLatitude) &&
      Number.isFinite(configuredLongitude) &&
      configuredLatitude >= -90 &&
      configuredLatitude <= 90 &&
      configuredLongitude >= -180 &&
      configuredLongitude <= 180 &&
      configuredLatitude !== 0 &&
      configuredLongitude !== 0
    )
    const latitude = hasConfiguredLocation ? configuredLatitude : 36.595557
    const longitude = hasConfiguredLocation ? configuredLongitude : 116.955628

    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      latitude !== 0 &&
      longitude !== 0
    ) {
      wx.openLocation({
        latitude,
        longitude,
        scale: 18,
        name: clinicInfo.name || '市中壹心堂门诊部',
        address: clinicInfo.address || '山东省济南市市中区七贤街道绿地国际城百花明都13号楼临街一层南起第二间'
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
          this.setData({ userInfo: {}, isLoggedIn: false, maskedPhone: '', userDisplayName: '' })
          wx.showToast({ title: '已退出登录', icon: 'success' })
        }
      }
    })
  }
})
