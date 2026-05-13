const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { services, date, start_time, end_time, total_duration } = event

  try {
    // 参数校验
    if (!services || !Array.isArray(services) || services.length === 0) {
      return { code: -1, message: '请选择服务项目' }
    }
    if (!date || !start_time || !end_time) {
      return { code: -1, message: '请选择预约日期和时段' }
    }
    if (!total_duration || total_duration <= 0) {
      return { code: -1, message: '服务时长无效' }
    }

    // 1. 检查用户是否被拉黑
    const userRes = await db.collection('users')
      .where({ openid: OPENID })
      .get()

    if (userRes.data.length > 0 && userRes.data[0].is_blacklisted) {
      return { code: -1, message: '您的账号注册信息有误，请联系门店' }
    }

    const holidaysRes = await db.collection('holidays')
      .where({ date: date })
      .get()
    if (holidaysRes.data.length > 0) {
      return { code: -1, message: '该日期为停业日，不可预约' }
    }

    // 2. 再次验证时段是否可用（防并发）
    const configRes = await db.collection('business_config').limit(1).get()
    const config = configRes.data[0]

    const dayOfWeek = new Date(date).getDay() || 7
    const workHours = config.schedule[dayOfWeek]

    // 检查是否在营业时间内
    const startMinutes = timeToMinutes(start_time)
    const endMinutes = timeToMinutes(end_time)
    let inWorkHours = false

    for (const period of workHours) {
      const periodStart = timeToMinutes(period.start)
      const periodEnd = timeToMinutes(period.end)
      if (startMinutes >= periodStart && endMinutes <= periodEnd) {
        inWorkHours = true
        break
      }
    }

    if (!inWorkHours) {
      return { code: -1, message: '该时段不在营业时间内' }
    }

    // 3. 检查技师数量是否足够
    const techRes = await db.collection('technicians')
      .where({ status: 'active' })
      .get()
    let techCount = techRes.data.length

    const daysOffRes = await db.collection('tech_days_off')
      .where({ date: date })
      .get()
    techCount -= daysOffRes.data.length
    techCount = Math.max(techCount, 0)

    // 4. 检查该时段已有预约数
    const appointmentsRes = await db.collection('appointments')
      .where({
        date: date,
        status: 'pending'
      })
      .get()

    let conflictCount = 0
    for (const apt of appointmentsRes.data) {
      const aptStart = timeToMinutes(apt.start_time)
      const aptEnd = timeToMinutes(apt.end_time)

      if (startMinutes < aptEnd && endMinutes > aptStart) {
        conflictCount++
      }
    }

    if (conflictCount >= techCount) {
      return { code: -1, message: '该时段已约满，请选择其他时段' }
    }

    // 5. 创建预约记录
    const appointmentData = {
      patient_openid: OPENID,
      services: services,
      total_duration: total_duration,
      technician_id: '',
      date: date,
      start_time: start_time,
      end_time: end_time,
      status: 'pending',
      qr_scene: '',
      verified_at: '',
      cancel_reason: '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }

    const addRes = await db.collection('appointments').add({
      data: appointmentData
    })

    // 6. 更新预约记录的qr_scene为_id
    await db.collection('appointments')
      .doc(addRes._id)
      .update({
        data: {
          qr_scene: addRes._id
        }
      })

    // 7. 生成小程序太阳码
    let qrCode = ''
    try {
      const qrRes = await cloud.openapi.wxacode.getUnlimited({
        scene: addRes._id.substring(0, 32), // scene最长32字符
        page: 'pages/tech-home/tech-home'
      })

      // 上传到云存储
      const uploadRes = await cloud.uploadFile({
        cloudPath: `qrcodes/${addRes._id}.jpg`,
        fileContent: qrRes.buffer
      })
      qrCode = uploadRes.fileID

      // 更新预约记录
      await db.collection('appointments')
        .doc(addRes._id)
        .update({
          data: { qr_code: qrCode }
        })
    } catch (qrErr) {
      console.error('生成二维码失败:', qrErr)
    }

    // 8. 发送预约成功通知
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: OPENID,
        templateId: 'your-template-id', // 替换为你的模板ID
        data: {
          thing1: { value: '预约成功' },
          time2: { value: `${date} ${start_time}` },
          thing3: { value: '请按时到店' }
        },
        page: `/pages/appointment-detail/appointment-detail?id=${addRes._id}`
      })
    } catch (notifyErr) {
      console.error('发送通知失败:', notifyErr)
    }

    return {
      code: 0,
      data: {
        _id: addRes._id,
        qr_code: qrCode
      }
    }
  } catch (err) {
    console.error('创建预约失败:', err)
    return { code: -1, message: err.message || '预约失败' }
  }
}

// 时间字符串转分钟数
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}
