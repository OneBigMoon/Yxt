const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { id } = event

  try {
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

    // 查询预约
    const aptRes = await db.collection('appointments')
      .doc(id)
      .get()

    if (!aptRes.data) {
      return { code: -1, message: '预约不存在' }
    }

    const appointment = aptRes.data

    // 验证预约状态（使用原子操作防重复核销）
    const updateRes = await db.collection('appointments')
      .where({
        _id: id,
        status: 'pending' // 只有待核销状态才能核销
      })
      .update({
        data: {
          status: 'completed',
          technician_id: technician._id,
          verified_at: formatDateTime(new Date()),
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
      await cloud.openapi.subscribeMessage.send({
        touser: appointment.patient_openid,
        templateId: 'your-template-id', // 替换为你的模板ID
        data: {
          thing1: { value: '核销完成' },
          time2: { value: formatDateTime(new Date()) },
          thing3: { value: '感谢您的光临' }
        }
      })
    } catch (notifyErr) {
      console.error('发送通知失败:', notifyErr)
    }

    return { code: 0, data: { message: '核销成功' } }
  } catch (err) {
    console.error('核销预约失败:', err)
    return { code: -1, message: err.message || '核销失败' }
  }
};

async function createCommissionRecords(appointment, technician) {
  try {
    // 获取服务信息
    const servicesRes = await db.collection('services')
      .where({
        _id: db.command.in(appointment.services || [])
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
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}
