const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { date, status } = event

  try {
    // 验证是否是技师
    const techRes = await db.collection('technicians')
      .where({
        openid: OPENID,
        status: 'active'
      })
      .get()

    if (techRes.data.length === 0) {
      return { code: -1, message: '无权操作' }
    }

    // 构建查询条件
    let query = {}

    if (date) {
      query.date = date
    }

    if (status) {
      query.status = status
    }

    // 查询预约
    const res = await db.collection('appointments')
      .where(query)
      .orderBy('start_time', 'asc')
      .get()

    // 获取服务名称和患者信息
    const appointments = await Promise.all(res.data.map(async (apt) => {
      // 获取服务名称
      const servicesRes = await db.collection('services')
        .where({
          _id: _.in(apt.services || [])
        })
        .get()

      const serviceNames = servicesRes.data.map(s => s.name).join('、')

      // 获取患者信息
      let patientName = '未知用户'
      const userRes = await db.collection('users')
        .where({ openid: apt.patient_openid })
        .get()

      if (userRes.data.length > 0) {
        patientName = userRes.data[0].nick_name || '未知用户'
      }

      return {
        ...apt,
        service_names: serviceNames,
        patient_name: patientName
      }
    }))

    return { code: 0, data: appointments }
  } catch (err) {
    console.error('获取预约列表失败:', err)
    return { code: -1, message: err.message || '获取预约失败' }
  }
}
