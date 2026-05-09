const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// 定时触发器：每分钟执行一次
exports.main = async (event, context) => {
  try {
    // 获取当前时间
    const now = new Date()
    const today = formatDate(now)
    const currentMinutes = now.getHours() * 60 + now.getMinutes()

    // 获取1小时后的时间
    const reminderMinutes = currentMinutes + 60
    const reminderTime = minutesToTime(reminderMinutes)

    // 查询今天待核销的预约
    const appointments = await db.collection('appointments')
      .where({
        date: today,
        status: 'pending',
        start_time: reminderTime
      })
      .get()

    console.log(`找到 ${appointments.data.length} 个需要提醒的预约`)

    // 发送提醒通知
    for (const apt of appointments.data) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: apt.patient_openid,
          templateId: 'your-reminder-template-id', // 替换为你的提醒模板ID
          data: {
            thing1: { value: '预约提醒' },
            time2: { value: `${apt.date} ${apt.start_time}` },
            thing3: { value: '您的预约即将开始，请准时到店' }
          },
          page: `/pages/appointment-detail/appointment-detail?id=${apt._id}`
        })

        console.log(`成功发送提醒给用户: ${apt.patient_openid}`)
      } catch (err) {
        console.error(`发送提醒失败: ${apt._id}`, err)
      }
    }

    return { code: 0, data: { count: appointments.data.length } }
  } catch (err) {
    console.error('定时提醒执行失败:', err)
    return { code: -1, message: err.message }
  }
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}
