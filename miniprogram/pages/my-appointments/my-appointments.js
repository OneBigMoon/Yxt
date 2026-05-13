const { getMyAppointments } = require('../../utils/api')

Page({
  data: {
    activeTab: 'pending',
    appointments: [],
    loading: true
  },

  onLoad() {
    this.loadAppointments()
  },

  onShow() {
    this.loadAppointments()
  },

  onPullDownRefresh() {
    this.loadAppointments().then(() => {
      wx.stopPullDownRefresh()
    })
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
      activeTab: e.detail,
      appointments: []
    })
    this.loadAppointments()
  },

  viewDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/appointment-detail/appointment-detail?id=${id}`
    })
  }
})
