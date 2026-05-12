const { getArticleDetail } = require('../../utils/api')

Page({
  data: {
    article: {},
    loading: true
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '文章不存在', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
      return
    }
    this.loadArticle(options.id)
  },

  async loadArticle(id) {
    this.setData({ loading: true })

    try {
      const article = await getArticleDetail(id)
      this.setData({
        article: article || {},
        loading: false
      })
    } catch (err) {
      console.error('获取文章详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  }
})
