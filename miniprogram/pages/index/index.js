const { getArticles, getConfig, getHolidays, checkAvailability } = require('../../utils/api')

Page({
  data: {
    clinicInfo: {},
    closureNotice: '',
    articles: [],
    loading: true,
    businessHourLines: [],
    businessStatusCards: [],
    homeCardState: { business_status: true, recommended_technicians: true, wellness_classroom: true },
    recommendedTechnicians: []
  },

  onLoad() {
    // 首次加载由 onShow 处理
  },

  onShow() {
    this.loadData().catch((err) => {
      console.error('[首页] onShow 触发 loadData 失败:', err)
    })
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh()
    }).catch((err) => {
      wx.stopPullDownRefresh()
      console.error('[首页] 下拉刷新 loadData 失败:', err)
    })
  },

  async loadData() {
    this.setData({ loading: true, closureNotice: '' })
    const startTs = Date.now()
    let config = {}
    let articles = []
    let holidays = []

    try {
      const configStart = Date.now()
      config = await this.loadConfig()
      console.log(`[首页] loadConfig 耗时: ${Date.now() - configStart}ms`)

      const articleStart = Date.now()
      articles = await this.loadArticles()
      console.log(`[首页] getArticles 耗时: ${Date.now() - articleStart}ms`)

      const holidaysStart = Date.now()
      holidays = await this.loadHolidays()
      console.log(`[首页] getHolidays 耗时: ${Date.now() - holidaysStart}ms`)

      const availabilityStart = Date.now()
      const availability = await this.loadAvailability()
      console.log(`[首页] checkAvailability 耗时: ${Date.now() - availabilityStart}ms`)

      let closureNotice = ''
      const today = this.formatDate(new Date())
      const todayHoliday = (holidays || []).find(h => h.date === today && h.type === 'closure')
      if (todayHoliday) {
        const nextDay = this.getNextBusinessDay(config, holidays)
        closureNotice = todayHoliday.reason
          ? `今日停业：${todayHoliday.reason}，预计${nextDay}恢复营业`
          : `今日停业，预计${nextDay}恢复营业`
      }

      const storeInfo = (config && config.store) || {}
      const businessHourLines = []
      if (config && config.schedule) {
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
        closureNotice,
        articles: articles || [],
        businessHourLines,
        businessStatusCards: this.buildBusinessStatusCards(availability.dateStatus || {}),
        homeCardState: this.buildHomeCardState(config.home_cards),
        recommendedTechnicians: this.normalizeRecommendedTechnicians(config.recommended_technicians),
        loading: false
      })
      console.log(`[首页] loadData 总耗时: ${Date.now() - startTs}ms`)
    } catch (err) {
      console.error('加载数据失败:', err)
      console.error('[首页] loadData 失败节点数据:', {
        configLoaded: Boolean(config),
        articlesLoaded: Array.isArray(articles),
        holidaysLoaded: Array.isArray(holidays),
        usedMs: Date.now() - startTs
      })
      this.setData({ loading: false, closureNotice: '' })
    }
  },

  async loadConfig() {
    try {
      const config = await getConfig()
      return config || {}
    } catch (err) {
      console.error('获取配置失败:', err)
      return {}
    }
  },

  async loadArticles() {
    try {
      return await getArticles()
    } catch (err) {
      console.error('获取文章失败:', err)
      return []
    }
  },

  async loadHolidays() {
    try {
      return await getHolidays({ type: 'closure' })
    } catch (err) {
      console.error('获取停业日失败:', err)
      return []
    }
  },

  async loadAvailability() {
    try {
      return await checkAvailability()
    } catch (err) {
      console.error('获取营业状态失败:', err)
      return { dateStatus: {} }
    }
  },

  buildBusinessStatusCards(dateStatus) {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    return [
      this.buildBusinessStatusCard('今日', today, dateStatus[this.formatDate(today)]),
      this.buildBusinessStatusCard('明日', tomorrow, dateStatus[this.formatDate(tomorrow)])
    ]
  },

  buildBusinessStatusCard(label, date, statusInfo) {
    const monthDay = `${date.getMonth() + 1}/${date.getDate()}`
    const status = statusInfo && statusInfo.status

    const statusMap = {
      available: { text: '营业可约', tone: 'open' },
      rest: { text: '休息', tone: 'closed' },
      closure: { text: '停业', tone: 'closed' },
      full: { text: '已约满', tone: 'busy' }
    }
    const display = statusMap[status] || { text: '营业待确认', tone: 'pending' }

    return {
      label,
      date: monthDay,
      text: display.text,
      tone: display.tone,
      iconColor: display.tone === 'open' ? '#5a7846' : '#7a6c66',
      reason: statusInfo && statusInfo.reason ? statusInfo.reason : ''
    }
  },

  getNextBusinessDay(config, holidays) {
    const today = new Date()
    for (let i = 1; i <= 30; i++) {
      const nextDay = new Date(today)
      nextDay.setDate(today.getDate() + i)
      const dateStr = this.formatDate(nextDay)
      const dayOfWeek = nextDay.getDay() || 7

      const isWorkDay = config.schedule && config.schedule[dayOfWeek] && config.schedule[dayOfWeek].length > 0
      const isHoliday = (holidays || []).some(h => h.date === dateStr)

      if (isWorkDay && !isHoliday) {
        return `${nextDay.getMonth() + 1}月${nextDay.getDate()}日`
      }
    }
    return '待定'
  },

  formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  callPhone() {
    const phone = this.data.clinicInfo.phone
    if (phone) {
      wx.makePhoneCall({ phoneNumber: phone })
    }
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
      return
    }

    wx.showToast({ title: '暂无门店位置信息', icon: 'none' })
  },

  buildHomeCardState(cards) {
    const state = {
      business_status: true,
      recommended_technicians: true,
      wellness_classroom: true
    }
    if (Array.isArray(cards)) {
      cards.forEach(item => {
        if (item && item.key && Object.prototype.hasOwnProperty.call(state, item.key)) {
          state[item.key] = item.enabled !== false
        }
      })
    }
    return state
  },

  normalizeRecommendedTechnicians(items) {
    const fallback = [
      { name: '李技师', specialty: '擅长颈肩调理', enabled: true, sort: 1 },
      { name: '王技师', specialty: '擅长脾胃养护', enabled: true, sort: 2 }
    ]
    const source = Array.isArray(items) ? items : fallback
    return source
      .filter(item => item && item.enabled !== false && item.name)
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      .map(item => ({
        name: String(item.name || '').trim(),
        specialty: String(item.specialty || '擅长中医调理').trim()
      }))
      .slice(0, 4)
  },

  goBooking() {
    wx.switchTab({
      url: '/pages/booking/booking'
    })
  },

  goMyAppointments() {
    wx.navigateTo({
      url: '/pages/my-appointments/my-appointments'
    })
  },

  onCoverError(e) {
    const index = e.currentTarget.dataset.index
    this.setData({
      [`articles[${index}].cover_image`]: '/images/default-article.png'
    })
  },

  viewArticle(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/article-detail/article-detail?id=${id}`
    })
  },

  viewArticles() {
    wx.showToast({ title: '暂无更多文章', icon: 'none' })
  },

})
