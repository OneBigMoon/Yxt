const { getTechAppointments, verifyAppointment } = require('../../utils/api')
const { checkAuth } = require('../../utils/auth')

Page({
  data: {
    activeTab: 'home',
    appointments: [],
    stats: {
      pending: 0,
      completed: 0
    },
    loading: true
  },

  onLoad() {
    this.checkAuth()
  },

  onShow() {
    this.checkAuth().then((userInfo) => {
      if (userInfo && userInfo.role === 'technician') {
        this.loadAppointments()
      }
    })
  },

  onPullDownRefresh() {
    this.loadAppointments().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  async checkAuth() {
    const userInfo = await checkAuth()
    if (!userInfo || userInfo.role !== 'technician') {
      wx.redirectTo({ url: '/pages/login/login' })
      return null
    }
    return userInfo
  },

  async loadAppointments() {
    this.setData({ loading: true })

    try {
      const today = this.formatDate(new Date())
      const appointments = await getTechAppointments({
        date: today
      })

      const pending = appointments.filter(a => a.status === 'pending').length
      const completed = appointments.filter(a => a.status === 'completed').length

      this.setData({
        appointments: appointments || [],
        stats: { pending, completed },
        loading: false
      })
    } catch (err) {
      console.error('获取预约列表失败:', err)
      this.setData({ loading: false })
    }
  },

  // 扫码核销
  scanCode() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: async (res) => {
        const scene = res.result
        if (scene) {
          await this.verifyAppointment(scene)
        } else {
          wx.showToast({ title: '无效的二维码', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('扫码失败:', err)
        wx.showToast({ title: '扫码取消', icon: 'none' })
      }
    })
  },

  // 核销预约
  async verifyAppointment(appointmentId) {
    try {
      wx.showLoading({ title: '核销中...' })

      const result = await verifyAppointment(appointmentId)

      wx.hideLoading()
      wx.showToast({ title: '核销成功', icon: 'success' })

      // 刷新列表
      setTimeout(() => {
        this.loadAppointments()
      }, 1000)
    } catch (err) {
      wx.hideLoading()
      console.error('核销失败:', err)
      wx.showModal({
        title: '核销失败',
        content: err.message || '请重试',
        showCancel: false
      })
    }
  },

  // 底部导航切换
  onTabChange(e) {
    const name = e.detail
    if (name === 'records') {
      wx.navigateTo({ url: '/pages/tech-records/tech-records' })
    }
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
})
