const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { id } = event

  try {
    const res = await db.collection('articles')
      .doc(id)
      .get()

    if (!res.data) {
      return { code: -1, message: '文章不存在' }
    }

    // 格式化时间 + 字段映射
    const article = {
      ...res.data,
      cover_image: res.data.cover_image || res.data.coverUrl || '',
      created_at: formatDate(res.data.created_at || res.data.createdAt)
    }

    return { code: 0, data: article }
  } catch (err) {
    console.error('获取文章详情失败:', err)
    return { code: -1, message: err.message || '获取失败' }
  }
}

function formatDate(date) {
  if (!date) return ''
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
