const { updateProfile } = require('../../utils/auth')

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    loading: false
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNicknameChange(e) {
    this.setData({ nickName: e.detail.value })
  },

  async onSubmit() {
    if (!this.data.nickName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }

    this.setData({ loading: true })

    try {
      await updateProfile(
        this.data.nickName,
        this.data.avatarUrl || ''
      )

      wx.showToast({ title: '注册成功', icon: 'success' })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' })
      }, 1000)
    } catch (err) {
      console.error('注册失败:', err)
      wx.showToast({ title: '注册失败，请重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
