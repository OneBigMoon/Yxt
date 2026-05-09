const { getArticles, getConfig } = require('../../utils/api')

Page({
  data: {
    clinicInfo: {},
    closureNotice: '',
    articles: [],
    loading: true
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    // 每次显示页面时刷新数据
    this.loadData()
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  async loadData() {
    this.setData({ loading: true })

    try {
      // 并行加载配置和文章
      const [config, articles] = await Promise.all([
        this.loadConfig(),
        this.loadArticles()
      ])

      this.setData({
        clinicInfo: config.store || {},
        closureNotice: config.closureNotice || '',
        articles: articles || [],
        loading: false
      })
    } catch (err) {
      console.error('加载数据失败:', err)
      this.setData({ loading: false })
    }
  },

  async loadConfig() {
    try {
      const config = await getConfig()
      // 检查今天是否停业
      let closureNotice = ''
      if (config.holidays) {
        const today = this.formatDate(new Date())
        const todayHoliday = config.holidays.find(h => h.date === today && h.type === 'closure')
        if (todayHoliday) {
          closureNotice = `今日停业，恢复营业日期：${this.getNextBusinessDay(config)}`
        }
      }

      return {
        store: config.store || {},
        closureNotice
      }
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

  // 获取下一个营业日
  getNextBusinessDay(config) {
    const today = new Date()
    for (let i = 1; i <= 30; i++) {
      const nextDay = new Date(today)
      nextDay.setDate(today.getDate() + i)
      const dateStr = this.formatDate(nextDay)
      const dayOfWeek = nextDay.getDay() || 7 // 1-7

      // 检查是否是营业日
      const isWorkDay = config.schedule && config.schedule[dayOfWeek] && config.schedule[dayOfWeek].length > 0
      const isHoliday = config.holidays && config.holidays.some(h => h.date === dateStr)

      if (isWorkDay && !isHoliday) {
        return `${nextDay.getMonth() + 1}月${nextDay.getDate()}日`
      }
    }
    return '待定'
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  // 拨打电话
  callPhone() {
    const phone = this.data.clinicInfo.phone
    if (phone) {
      wx.makePhoneCall({ phoneNumber: phone })
    }
  },

  // 查看文章详情
  viewArticle(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/article-detail/article-detail?id=${id}`
    })
  },

  // 查看全部文章
  viewAllArticles() {
    // TODO: 跳转到文章列表页
    wx.showToast({ title: '功能开发中', icon: 'none' })
  }
})
