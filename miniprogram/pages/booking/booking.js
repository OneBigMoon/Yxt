const { getServices, getAvailableSlots, createAppointment, getConfig } = require('../../utils/api')

Page({
  data: {
    currentStep: 1,
    services: [],
    selectedServices: [],
    totalDuration: 0,
    showCalendar: false,
    selectedDate: '',
    minDate: Date.now(),
    maxDate: Date.now() + 14 * 24 * 60 * 60 * 1000,
    timeSlots: [],
    slotsLoading: false,
    selectedSlot: null,
    bookingLoading: false,
    showSuccess: false
  },

  onLoad() {
    this.loadServices()
    this.loadConfig()
  },

  async loadServices() {
    try {
      const services = await getServices()
      this.setData({
        services: (services || []).map(s => ({ ...s, selected: false }))
      })
    } catch (err) {
      console.error('获取服务列表失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async loadConfig() {
    try {
      const config = await getConfig()
      if (config.max_advance_days) {
        this.setData({
          maxDate: Date.now() + config.max_advance_days * 24 * 60 * 60 * 1000
        })
      }
    } catch (err) {
      console.error('获取配置失败:', err)
    }
  },

  // 切换服务选择
  toggleService(e) {
    const index = e.currentTarget.dataset.index
    const services = this.data.services
    services[index].selected = !services[index].selected

    const selectedServices = services.filter(s => s.selected)
    const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0)

    this.setData({
      services,
      selectedServices,
      totalDuration
    })
  },

  // 下一步
  nextStep() {
    if (this.data.currentStep === 1 && this.data.selectedServices.length === 0) {
      wx.showToast({ title: '请至少选择一个服务项目', icon: 'none' })
      return
    }

    if (this.data.currentStep === 2) {
      this.setData({ showCalendar: true })
      return
    }

    this.setData({ currentStep: this.data.currentStep + 1 })

    if (this.data.currentStep === 3) {
      this.loadTimeSlots()
    }
  },

  // 上一步
  prevStep() {
    this.setData({
      currentStep: this.data.currentStep - 1,
      selectedSlot: null
    })
  },

  // 日期选择确认
  onDateConfirm(e) {
    const date = new Date(e.detail)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`

    this.setData({
      selectedDate: dateStr,
      showCalendar: false,
      currentStep: 3,
      selectedSlot: null
    })

    this.loadTimeSlots()
  },

  // 关闭日历
  onCalendarClose() {
    this.setData({ showCalendar: false })
  },

  // 加载可用时段
  async loadTimeSlots() {
    this.setData({ slotsLoading: true, timeSlots: [] })

    try {
      const serviceIds = this.data.selectedServices.map(s => s._id)
      const slots = await getAvailableSlots({
        date: this.data.selectedDate,
        serviceIds: serviceIds,
        totalDuration: this.data.totalDuration
      })

      this.setData({
        timeSlots: (slots || []).map(s => ({
          ...s,
          selected: false
        })),
        slotsLoading: false
      })
    } catch (err) {
      console.error('获取时段失败:', err)
      this.setData({ slotsLoading: false })
      wx.showToast({ title: '获取时段失败', icon: 'none' })
    }
  },

  // 选择时段
  selectSlot(e) {
    const index = e.currentTarget.dataset.index
    const slot = this.data.timeSlots[index]

    if (!slot.available) return

    const timeSlots = this.data.timeSlots.map((s, i) => ({
      ...s,
      selected: i === index
    }))

    this.setData({
      timeSlots,
      selectedSlot: slot
    })
  },

  // 确认预约
  async confirmBooking() {
    if (!this.data.selectedSlot) {
      wx.showToast({ title: '请选择时段', icon: 'none' })
      return
    }

    this.setData({ bookingLoading: true })

    try {
      const serviceIds = this.data.selectedServices.map(s => s._id)
      await createAppointment({
        services: serviceIds,
        date: this.data.selectedDate,
        start_time: this.data.selectedSlot.time.split('-')[0],
        end_time: this.data.selectedSlot.time.split('-')[1],
        total_duration: this.data.totalDuration
      })

      this.setData({
        showSuccess: true,
        bookingLoading: false
      })
    } catch (err) {
      console.error('预约失败:', err)
      this.setData({ bookingLoading: false })
      wx.showToast({ title: err.message || '预约失败', icon: 'none' })
    }
  },

  // 跳转到预约列表
  goToAppointments() {
    this.setData({ showSuccess: false })
    wx.switchTab({
      url: '/pages/mine/mine'
    })
  },

  // 关闭成功弹窗
  onSuccessClose() {
    this.setData({ showSuccess: false })
  }
})
