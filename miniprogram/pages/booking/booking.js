const { getServices, getAvailableSlots, checkAvailability, createAppointment, getConfig, getHolidays } = require('../../utils/api')

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
    showSuccess: false,
    restDays: [],
    holidays: [],
    calendarFormatter: null,
    closureNotice: '',
    // 可预约性
    pageLoading: true,
    hasAnyAvailable: false,
    availabilityMessage: '',
    dateStatus: {}
  },

  onLoad() {
    const { checkAuth } = require('../../utils/auth')
    checkAuth().then((userInfo) => {
      const start = Date.now()

      if (!userInfo) {
        wx.redirectTo({ url: '/pages/login/login' })
        return
      }

      this._authChecked = true
      this.loadConfig()
        .then(() => this.loadServices())
        .then(() => this.scanAvailability())
        .then(() => {
          console.log('[预约页] 初始化流程耗时:', Date.now() - start)
        })
        .catch((err) => {
          console.error('[预约页] 初始化失败:', err)
        })

      this.setData({
        calendarFormatter: (day) => {
          const date = new Date(day.date)
          const dateStr = this.formatDate(date)
          const status = this.data.dateStatus[dateStr]

          if (status) {
            if (status.status === 'rest') {
              day.type = 'disabled'
              day.bottomInfo = '休息'
            } else if (status.status === 'closure') {
              day.type = 'disabled'
              day.bottomInfo = '停业'
            } else if (status.status === 'full') {
              day.type = 'disabled'
              day.bottomInfo = '约满'
            }
            // available: 不设置 type，保持可选
          }

          return day
        }
      })
    })
  },

  onShow() {
    // 每次页面显示时刷新配置和可预约状态
    if (this._authChecked) {
      const start = Date.now()
      this.loadConfig()
        .then(() => this.scanAvailability())
        .then(() => {
          console.log('[预约页] onShow 刷新耗时:', Date.now() - start)
        })
        .catch((err) => {
          console.error('[预约页] onShow 刷新失败:', err)
        })
    }
  },

  async scanAvailability(totalDuration) {
    try {
      const params = totalDuration ? { totalDuration } : {}
      const start = Date.now()
      const result = await checkAvailability(params)
      console.log('[预约页] checkAvailability 耗时:', Date.now() - start)

      this.setData({
        hasAnyAvailable: result.hasAnyAvailable,
        availabilityMessage: result.message || '',
        dateStatus: result.dateStatus || {},
        pageLoading: false
      })
    } catch (err) {
      console.error('扫描可预约日期失败:', err)
      this.setData({
        hasAnyAvailable: false,
        availabilityMessage: '检查预约状态失败，请重试',
        pageLoading: false
      })
    }
  },

  async loadServices() {
    const start = Date.now()
    try {
      const services = await getServices()
      console.log('[预约页] getServices 耗时:', Date.now() - start)
      this.setData({
        services: (services || []).map(s => ({ ...s, selected: false }))
      })
    } catch (err) {
      console.error('获取服务列表失败:', err)
    }
  },

  async loadConfig() {
    const start = Date.now()
    try {
      const config = await getConfig()
      const holidaysData = await getHolidays({ type: 'closure' })
      console.log('[预约页] getConfig + getHolidays 耗时:', Date.now() - start)

      const maxAdvanceDays = config.max_advance_days || 14
      const maxDate = Date.now() + maxAdvanceDays * 24 * 60 * 60 * 1000

      const restDays = []
      if (config.schedule) {
        for (let i = 1; i <= 7; i++) {
          if (!config.schedule[i] || config.schedule[i].length === 0) {
            restDays.push(i)
          }
        }
      }

      this.setData({
        maxDate,
        restDays,
        holidays: holidaysData || []
      })
    } catch (err) {
      console.error('获取配置失败:', err)
    }
  },

  onCalendarDayClick(e) {
    const date = new Date(e.detail)
    const dateStr = this.formatDate(date)
    const status = this.data.dateStatus[dateStr]

    if (status && status.status === 'rest') {
      wx.showToast({ title: '该日为休息日', icon: 'none' })
      return
    }
    if (status && status.status === 'closure') {
      wx.showToast({ title: status.reason || '当日停业', icon: 'none' })
      return
    }
    if (status && status.status === 'full') {
      wx.showToast({ title: '该日预约已满', icon: 'none' })
      return
    }

    this.setData({
      selectedDate: dateStr,
      showCalendar: false
    })
  },

  formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  toggleService(e) {
    const index = e.currentTarget.dataset.index
    const services = this.data.services.map((s, i) =>
      i === index ? { ...s, selected: !s.selected } : s
    )

    const selectedServices = services.filter(s => s.selected)
    const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0)

    this.setData({ services, selectedServices, totalDuration })
  },

  nextStep() {
    // 步骤1：必须选日期
    if (this.data.currentStep === 1) {
      if (!this.data.selectedDate) {
        wx.showToast({ title: '请选择预约日期', icon: 'none' })
        return
      }
      this.setData({ currentStep: 2 })
      return
    }

    // 步骤2：必须选服务
    if (this.data.currentStep === 2) {
      if (this.data.selectedServices.length === 0) {
        wx.showToast({ title: '请至少选择一个服务项目', icon: 'none' })
        return
      }
      // 用实际时长验证所选日期是否还有空位
      this.verifyDateAvailability()
      return
    }
  },

  prevStep() {
    if (this.data.currentStep === 2) {
      // 返回日期选择时，用已选服务时长重新扫描可用日期
      this.setData({ currentStep: 1, selectedDate: '', selectedSlot: null })
      if (this.data.totalDuration > 0) {
        this.scanAvailability(this.data.totalDuration)
      }
    } else if (this.data.currentStep === 3) {
      this.setData({ currentStep: 2, selectedSlot: null, timeSlots: [] })
    }
  },

  async verifyDateAvailability() {
    wx.showLoading({ title: '验证时段...' })
    const start = Date.now()

    try {
      const result = await checkAvailability({ totalDuration: this.data.totalDuration })
      console.log('[预约页] verifyDateAvailability.checkAvailability 耗时:', Date.now() - start)
      const dateStatus = result.dateStatus || {}
      const todayStatus = dateStatus[this.data.selectedDate]

      wx.hideLoading()

      if (todayStatus && todayStatus.status === 'full') {
        // 所选日期已满，更新日历状态，回到日期选择
        this.setData({
          dateStatus,
          selectedDate: '',
          currentStep: 1
        })
        wx.showToast({ title: '该日期已约满，请重新选择', icon: 'none' })
        return
      }

      // 日期可用，进入时段选择
      this.setData({ currentStep: 3 })
      this.loadTimeSlots()
    } catch (err) {
      wx.hideLoading()
      console.error('验证日期可用性失败:', err)
      // 验证失败也允许继续
      this.setData({ currentStep: 3 })
      this.loadTimeSlots()
    }
  },

  openCalendar() {
    this.setData({ showCalendar: true })
  },

  onCalendarClose() {
    this.setData({ showCalendar: false })
  },

  async loadTimeSlots() {
    const start = Date.now()
    this.setData({ slotsLoading: true, timeSlots: [] })

    try {
      const serviceIds = this.data.selectedServices.map(s => s._id)
      const slots = await getAvailableSlots({
        date: this.data.selectedDate,
        serviceIds: serviceIds,
        totalDuration: this.data.totalDuration
      })

      this.setData({
        timeSlots: (slots || []).filter(s => s.available).map(s => ({
          ...s,
          selected: false
        })),
        slotsLoading: false
      })
      console.log('[预约页] getAvailableSlots 耗时:', Date.now() - start)
    } catch (err) {
      console.error('获取时段失败:', err)
      this.setData({ slotsLoading: false })
      wx.showToast({ title: '获取时段失败', icon: 'none' })
    }
  },

  selectSlot(e) {
    const index = e.currentTarget.dataset.index
    const slot = this.data.timeSlots[index]

    const timeSlots = this.data.timeSlots.map((s, i) => ({
      ...s,
      selected: i === index
    }))

    this.setData({ timeSlots, selectedSlot: slot })
  },

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

      this.setData({ showSuccess: true, bookingLoading: false })
    } catch (err) {
      console.error('预约失败:', err)
      this.setData({ bookingLoading: false, selectedSlot: null })

      if (err.message && err.message.includes('约满')) {
        wx.showToast({ title: '该时段已约满，正在刷新', icon: 'none' })
        this.loadTimeSlots()
      } else {
        wx.showToast({ title: err.message || '预约失败', icon: 'none' })
      }
    }
  },

  goToAppointments() {
    this.setData({ showSuccess: false })
    wx.navigateTo({ url: '/pages/my-appointments/my-appointments' })
  },

  onSuccessClose() {
    this.setData({ showSuccess: false })
  }
})
