const { getMyAppointments, getConfig } = require('../../utils/api')
const { checkAuth } = require('../../utils/auth')

Page({
  data: {
    userInfo: {},
    clinicInfo: {},
    activeTab: 'pending',
    appointments: [],
    loading: true
  },

  onLoad() {
    this.loadUserInfo()
    this.loadConfig()
  },

  onShow() {
    this.loadUserInfo()
    this.loadAppointments()
  },

  onPullDownRefresh() {
    Promise.all([
      this.loadConfig(),
      this.loadAppointments()
    ]).then(() => {
      wx.stopPullDownRefresh()
    })
  },

  loadUserInfo() {
    checkAuth().then(userInfo => {
      if (userInfo) {
        this.setData({ userInfo })
      }
    })
  },

  async loadConfig() {
    try {
      const config = await getConfig()
      this.setData({
        clinicInfo: config.store || {}
      })
    } catch (err) {
      console.error('获取配置失败:', err)
    }
  },

  async loadAppointments() {
    this.setData({ loading: true })

    try {
      const appointments = await getMyAppointments({
        status: this.data.activeTab
      })

      this.setData({
        appointments: appointments || [],
        loading: false
      })
    } catch (err) {
      console.error('获取预约列表失败:', err)
      this.setData({ loading: false })
    }
  },

  onTabChange(e) {
    this.setData({
      activeTab: e.detail.name,
      appointments: []
    })
    this.loadAppointments()
  },

  viewDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/appointment-detail/appointment-detail?id=${id}`
    })
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
    }
  }
})
