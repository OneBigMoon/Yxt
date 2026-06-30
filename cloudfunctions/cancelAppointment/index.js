const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const APPOINTMENT_CANCELLED_TEMPLATE_ID = process.env.SUBSCRIBE_TEMPLATE_APPOINTMENT_CANCELLED || ''

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { id } = event

  try {
    // 参数校验
    if (!id) {
      return { code: -1, message: '缺少预约ID' }
    }

    // 查询预约
    const aptRes = await db.collection('appointments')
      .doc(id)
      .get()

    if (!aptRes.data) {
      return { code: -1, message: '预约不存在' }
    }

    const appointment = aptRes.data

    // 验证是否是本人的预约
    if (appointment.patient_openid !== OPENID) {
      return { code: -1, message: '无权操作此预约' }
    }

    // 验证预约状态
    if (appointment.status !== 'pending') {
      return { code: -1, message: '该预约无法取消' }
    }

    // 取消预约
    await db.collection('appointments')
      .doc(id)
      .update({
        data: {
          status: 'cancelled',
          updated_at: db.serverDate()
        }
      })

    // 发送取消通知
    try {
      if (APPOINTMENT_CANCELLED_TEMPLATE_ID) {
        await cloud.openapi.subscribeMessage.send({
          touser: OPENID,
          templateId: APPOINTMENT_CANCELLED_TEMPLATE_ID,
          data: {
            thing1: { value: '预约取消' },
            time2: { value: `${appointment.date} ${appointment.start_time}` },
            thing3: { value: '已取消预约' }
          }
        })
      } else {
        console.warn('未配置预约取消订阅消息模板，跳过通知')
      }
    } catch (notifyErr) {
      console.error('发送通知失败:', notifyErr)
    }

    return { code: 0, data: { message: '取消成功' } }
  } catch (err) {
    console.error('取消预约失败:', err)
    return { code: -1, message: err.message || '取消失败' }
  }
}
