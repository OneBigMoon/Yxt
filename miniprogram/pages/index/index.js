const { getArticles, getConfig, getHolidays } = require('../../utils/api')

Page({
  data: {
    clinicInfo: {},
    closureNotice: '',
    articles: [],
    loading: true
  },

  onLoad() {
    // 首次加载由 onShow 处理
  },

  onShow() {
    this.loadData()
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  async loadData() {
    this.setData({ loading: true, closureNotice: '' })

    try {
      const [config, articles, holidays] = await Promise.all([
        this.loadConfig(),
        this.loadArticles(),
        this.loadHolidays()
      ])

      let closureNotice = ''
      const today = this.formatDate(new Date())
      const todayHoliday = (holidays || []).find(h => h.date === today && h.type === 'closure')
      if (todayHoliday) {
        const nextDay = this.getNextBusinessDay(config, holidays)
        closureNotice = todayHoliday.reason
          ? `今日停业：${todayHoliday.reason}，预计${nextDay}恢复营业`
          : `今日停业，预计${nextDay}恢复营业`
      }

      this.setData({
        clinicInfo: (config && config.store) || {},
        closureNotice,
        articles: articles || [],
        loading: false
      })
    } catch (err) {
      console.error('加载数据失败:', err)
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

})
