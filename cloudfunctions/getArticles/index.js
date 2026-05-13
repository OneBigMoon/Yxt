const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  try {
    const res = await db.collection('articles')
      .where({ status: _.neq('deleted') })
      .orderBy('sort_order', 'asc')
      .limit(10)
      .get()

    // 转换 cloud:// 封面图为 https
    const cloudIds = res.data
      .map(a => a.cover_image || a.coverUrl)
      .filter(u => u && u.startsWith('cloud://'))

    if (cloudIds.length > 0) {
      try {
        const urlRes = await cloud.getTempFileURL({ fileList: cloudIds })
        const urlMap = {}
        urlRes.fileList.forEach(f => { urlMap[f.fileID] = f.tempFileURL })
        res.data.forEach(a => {
          const key = a.cover_image || a.coverUrl
          if (key && urlMap[key]) {
            a.cover_image = urlMap[key]
          }
        })
      } catch (e) {
        console.error('转换封面图链接失败:', e.message)
      }
    }

    const articles = res.data.map(article => ({
      ...article,
      cover_image: article.cover_image || article.coverUrl || '',
      created_at: formatDate(article.created_at || article.createdAt)
    }))

    return { code: 0, data: articles }
  } catch (err) {
    console.error('获取文章列表失败:', err)
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
