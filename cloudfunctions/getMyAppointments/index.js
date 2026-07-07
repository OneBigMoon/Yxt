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
      let appointment = apt
      if (id && apt.status === 'pending' && (!apt.verify_code || !apt.qr_code)) {
        appointment = await ensureVerificationPayload(apt)
      }

      // 获取服务名称
      let serviceNames = ''
      if (appointment.services && appointment.services.length > 0) {
        const servicesRes = await db.collection('services')
          .where({ _id: _.in(appointment.services) })
          .get()
        serviceNames = servicesRes.data.map(s => s.name).join('、')
      }

      // 获取技师名称
      let technicianName = ''
      if (appointment.technician_id) {
        try {
          const techRes = await db.collection('technicians')
            .doc(appointment.technician_id)
            .get()
          if (techRes.data) {
            technicianName = techRes.data.name
          }
        } catch (e) {
          console.error('获取技师信息失败:', e.message)
        }
      }

      return {
        ...appointment,
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

async function ensureVerificationPayload(appointment) {
  const verifyCode = isVerifyCode(appointment.verify_code)
    ? appointment.verify_code
    : await generateUniqueVerifyCode()
  const data = {
    verify_code: verifyCode,
    qr_scene: verifyCode
  }

  if (!appointment.qr_code) {
    try {
      data.qr_code = await createQrCode(appointment._id, verifyCode)
    } catch (err) {
      console.error('补生成预约二维码失败:', err)
    }
  }

  await db.collection('appointments')
    .doc(appointment._id)
    .update({
      data: {
        ...data,
        updated_at: db.serverDate()
      }
    })

  return {
    ...appointment,
    ...data
  }
}

async function createQrCode(appointmentId, verifyCode) {
  const qrRes = await cloud.callFunction({
    name: 'admin',
    data: {
      action: 'createAppointmentQrCode',
      data: {
        appointment_id: appointmentId,
        scene: verifyCode
      }
    }
  })

  if (!qrRes || !qrRes.result || qrRes.result.code !== 0) {
    throw new Error((qrRes && qrRes.result && qrRes.result.message) || '二维码生成失败')
  }

  return qrRes.result.data && qrRes.result.data.file_id ? qrRes.result.data.file_id : ''
}

async function generateUniqueVerifyCode() {
  for (let i = 0; i < 8; i++) {
    const code = randomVerifyCode()
    const res = await db.collection('appointments')
      .where({
        verify_code: code,
        status: 'pending'
      })
      .limit(1)
      .get()

    if (!res.data || res.data.length === 0) {
      return code
    }
  }

  throw new Error('核销码生成失败，请稍后重试')
}

function randomVerifyCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
}

function isVerifyCode(value) {
  return /^\d{6}$/.test(String(value || ''))
}
