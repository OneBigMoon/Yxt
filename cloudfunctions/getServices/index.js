const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  try {
    const res = await db.collection('services')
      .where({
        status: 'active'
      })
      .orderBy('sort_order', 'asc')
      .get()

    return { code: 0, data: res.data }
  } catch (err) {
    console.error('获取服务列表失败:', err)
    return { code: -1, message: err.message || '获取失败' }
  }
}
