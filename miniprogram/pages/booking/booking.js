const { getServices, getAvailableSlots, createAppointment, getConfig, getHolidays } = require('../../utils/api')

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
    disabledDates: [],
    restDays: [],
    holidays: [],
    calendarFormatter: null,
    closureNotice: ''
  },

  onLoad() {
    const { checkAuth } = require('../../utils/auth')
    checkAuth().then((userInfo) => {
      if (!userInfo) {
        wx.redirectTo({ url: '/pages/login/login' })
        return
      }

      this.loadServices()
      this.loadConfig()

      this.setData({
        calendarFormatter: (day) => {
          const date = new Date(day.date)
          const dayOfWeek = date.getDay() || 7

          if (this.data.restDays.includes(dayOfWeek)) {
            day.type = 'disabled'
            day.bottomInfo = '休息'
          }

          const dateStr = this.formatDate(date)
          const holidays = this.data.holidays || []
          const holiday = holidays.find(h => h.date === dateStr)
          if (holiday) {
            day.type = 'disabled'
            day.bottomInfo = '停业'
          }

          return day
        }
      })
    })
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
      const holidaysData = await getHolidays({ type: 'closure' })

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

      const disabledDates = []
      const now = new Date()
      for (let d = 0; d <= maxAdvanceDays; d++) {
        const checkDate = new Date(now.getTime() + d * 24 * 60 * 60 * 1000)
        const dayOfWeek = checkDate.getDay() || 7
        if (restDays.includes(dayOfWeek)) {
          disabledDates.push(checkDate.getTime())
        }
      }

      const holidays = holidaysData || []
      for (const h of holidays) {
        const hDate = new Date(h.date)
        hDate.setHours(0, 0, 0, 0)
        disabledDates.push(hDate.getTime())
      }

      // 检查今天是否停业
      const today = this.formatDate(new Date())
      const todayHoliday = holidays.find(h => h.date === today)
      let closureNotice = ''
      if (todayHoliday) {
        const nextDay = this.findNextBusinessDay(restDays, holidays, maxAdvanceDays)
        closureNotice = todayHoliday.reason
          ? `今日停业：${todayHoliday.reason}，预计${nextDay}恢复营业`
          : `今日停业，预计${nextDay}恢复营业`
      }

      this.setData({
        maxDate,
        restDays,
        disabledDates,
        holidays,
        closureNotice
      })
    } catch (err) {
      console.error('获取配置失败:', err)
    }
  },

  onCalendarDayClick(e) {
    const date = new Date(e.detail)
    const dayOfWeek = date.getDay() || 7

    if (this.data.restDays.includes(dayOfWeek)) {
      const dayNames = ['', '一', '二', '三', '四', '五', '六', '日']
      wx.showToast({ title: `周${dayNames[dayOfWeek]}为休息日`, icon: 'none' })
      return
    }

    const dateStr = this.formatDate(date)
    const holidays = this.data.holidays || []
    const holiday = holidays.find(h => h.date === dateStr)
    if (holiday) {
      wx.showToast({ title: holiday.reason || '当日停业', icon: 'none' })
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

  findNextBusinessDay(restDays, holidays, maxDays) {
    const now = new Date()
    for (let d = 1; d <= maxDays; d++) {
      const checkDate = new Date(now.getTime() + d * 24 * 60 * 60 * 1000)
      const dayOfWeek = checkDate.getDay() || 7
      const dateStr = this.formatDate(checkDate)
      const isRestDay = restDays.includes(dayOfWeek)
      const isHoliday = holidays.some(h => h.date === dateStr)
      if (!isRestDay && !isHoliday) {
        return `${checkDate.getMonth() + 1}月${checkDate.getDate()}日`
      }
    }
    return '待定'
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
    if (this.data.currentStep === 1 && this.data.selectedServices.length === 0) {
      wx.showToast({ title: '请至少选择一个服务项目', icon: 'none' })
      return
    }

    const next = this.data.currentStep + 1
    const update = { currentStep: next }

    if (next === 2) {
      update.showCalendar = true
    }

    this.setData(update, () => {
      if (next === 3) {
        this.loadTimeSlots()
      }
    })
  },

  openCalendar() {
    this.setData({ showCalendar: true })
  },

  prevStep() {
    this.setData({
      currentStep: this.data.currentStep - 1,
      selectedSlot: null
    })
  },

  onDateConfirm(e) {
    const date = new Date(e.detail)
    const dateStr = this.formatDate(date)

    this.setData({
      selectedDate: dateStr,
      showCalendar: false,
      selectedSlot: null
    })
  },

  onCalendarClose() {
    this.setData({ showCalendar: false })
  },

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
        timeSlots: (slots || []).filter(s => s.available).map(s => ({
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
