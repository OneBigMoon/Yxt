const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { status, id } = event

  try {
    let conditions = { patient_openid: OPENID }

    if (id) {
      conditions._id = id
    }

    if (status && !id) {
      conditions.status = status
    }

    let query = db.collection('appointments')
      .where(conditions)

    const res = await query
      .orderBy('created_at', 'desc')
      .get()

    // 获取服务名称和技师名称
    const appointments = await Promise.all(res.data.map(async (apt) => {
      // 获取服务名称
      let serviceNames = ''
      if (apt.services && apt.services.length > 0) {
        const servicesRes = await db.collection('services')
          .where({ _id: _.in(apt.services) })
          .get()
        serviceNames = servicesRes.data.map(s => s.name).join('、')
      }

      // 获取技师名称
      let technicianName = ''
      if (apt.technician_id) {
        try {
          const techRes = await db.collection('technicians')
            .doc(apt.technician_id)
            .get()
          if (techRes.data) {
            technicianName = techRes.data.name
          }
        } catch (e) {
          console.error('获取技师信息失败:', e.message)
        }
      }

      return {
        ...apt,
        service_names: serviceNames,
        technician_name: technicianName
      }
    }))

    return { code: 0, data: appointments }
  } catch (err) {
    console.error('获取预约列表失败:', err)
    return { code: -1, message: err.message || '获取预约失败' }
  }
}
