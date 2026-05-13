const { getTechAppointments } = require('../../utils/api')
const { checkAuth } = require('../../utils/auth')

Page({
  data: {
    records: [],
    loading: true
  },

  async onLoad() {
    const userInfo = await checkAuth()
    if (!userInfo || userInfo.role !== 'technician') {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.loadRecords()
  },

  onPullDownRefresh() {
    this.loadRecords().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  async loadRecords() {
    this.setData({ loading: true })

    try {
      const today = this.formatDate(new Date())
      const appointments = await getTechAppointments({
        date: today,
        status: 'completed'
      })

      this.setData({
        records: appointments || [],
        loading: false
      })
    } catch (err) {
      console.error('获取核销记录失败:', err)
      this.setData({ loading: false })
    }
  },

  formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
})
