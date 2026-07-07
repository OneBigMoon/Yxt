const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const APPOINTMENT_VERIFIED_TEMPLATE_ID = process.env.SUBSCRIBE_TEMPLATE_APPOINTMENT_VERIFIED || ''

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { id } = event
  const verifyValue = String(id || '').trim()

  try {
    // 参数校验
    if (!verifyValue) {
      return { code: -1, message: '缺少核销码' }
    }

    // 验证是否是技师
    const techRes = await db.collection('technicians')
      .where({
        openid: OPENID,
        status: 'active'
      })
      .get()

    if (techRes.data.length === 0) {
      return { code: -1, message: '无权操作，仅技师可核销' }
    }

    const technician = techRes.data[0]

    // 查询预约：新预约用6位核销码，旧流程仍兼容预约ID
    const lookup = await findAppointmentForVerify(verifyValue)
    if (!lookup) {
      return { code: -1, message: isVerifyCode(verifyValue) ? '核销码无效' : '预约不存在' }
    }

    const { appointment, appointmentId } = lookup

    // 验证预约状态（使用原子操作防重复核销）
    const updateRes = await db.collection('appointments')
      .where({
        _id: appointmentId,
        status: 'pending' // 只有待核销状态才能核销
      })
      .update({
        data: {
          status: 'completed',
          technician_id: technician._id,
          verified_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })

    if (updateRes.stats.updated === 0) {
      return { code: -1, message: '该预约已核销或状态异常' }
    }

    // 计算提成并记录
    await createCommissionRecords(appointment, technician)

    // 发送核销完成通知
    try {
      if (APPOINTMENT_VERIFIED_TEMPLATE_ID) {
        await cloud.openapi.subscribeMessage.send({
          touser: appointment.patient_openid,
          templateId: APPOINTMENT_VERIFIED_TEMPLATE_ID,
          data: {
            thing1: { value: '核销完成' },
            time2: { value: formatDateTime(new Date()) },
            thing3: { value: '感谢您的光临' }
          }
        })
      } else {
        console.warn('未配置核销完成订阅消息模板，跳过通知')
      }
    } catch (notifyErr) {
      console.error('发送通知失败:', notifyErr)
    }

    return { code: 0, data: { message: '核销成功' } }
  } catch (err) {
    console.error('核销预约失败:', err)
    return { code: -1, message: err.message || '核销失败' }
  }
};

async function findAppointmentForVerify(value) {
  if (isVerifyCode(value)) {
    const codeRes = await db.collection('appointments')
      .where({ verify_code: value })
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()

    if (codeRes.data && codeRes.data.length > 0) {
      return {
        appointment: codeRes.data[0],
        appointmentId: codeRes.data[0]._id
      }
    }

    const sceneRes = await db.collection('appointments')
      .where({ qr_scene: value })
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()

    if (sceneRes.data && sceneRes.data.length > 0) {
      return {
        appointment: sceneRes.data[0],
        appointmentId: sceneRes.data[0]._id
      }
    }
  }

  try {
    const aptRes = await db.collection('appointments').doc(value).get()
    if (aptRes.data) {
      return {
        appointment: aptRes.data,
        appointmentId: value
      }
    }
  } catch (err) {
    if (!isVerifyCode(value)) {
      throw err
    }
  }

  return null
}

function isVerifyCode(value) {
  return /^\d{6}$/.test(String(value || ''))
}

async function createCommissionRecords(appointment, technician) {
  try {
    if (!appointment.services || appointment.services.length === 0) {
      console.warn('预约无服务项目，跳过提成记录')
      return
    }

    // 获取服务信息
    const servicesRes = await db.collection('services')
      .where({
        _id: db.command.in(appointment.services)
      })
      .get()

    for (const service of servicesRes.data) {
      // 确定提成金额（优先技师个人提成）
      let commissionAmount = service.default_commission || 0
      let commissionType = 'default'

      if (technician.custom_commissions && technician.custom_commissions[service._id]) {
        commissionAmount = technician.custom_commissions[service._id]
        commissionType = 'custom'
      }

      // 创建提成记录（快照当时的价格和提成）
      await db.collection('commission_records').add({
        data: {
          technician_id: technician._id,
          technician_name: technician.name,
          appointment_id: appointment._id,
          service_id: service._id,
          service_name: service.name,
          service_price: service.price,
          commission_amount: commissionAmount,
          commission_type: commissionType,
          date: appointment.date,
          created_at: db.serverDate()
        }
      })
    }
  } catch (err) {
    console.error('创建提成记录失败:', err)
  }
}

function formatDateTime(date) {
  // 转换为北京时间 (UTC+8)
  const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const year = bj.getUTCFullYear()
  const month = String(bj.getUTCMonth() + 1).padStart(2, '0')
  const day = String(bj.getUTCDate()).padStart(2, '0')
  const hours = String(bj.getUTCHours()).padStart(2, '0')
  const minutes = String(bj.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}
