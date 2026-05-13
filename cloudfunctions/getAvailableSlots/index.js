const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { date, serviceIds, totalDuration } = event

  try {
    // 参数校验
    if (!date) {
      return { code: -1, message: '请选择预约日期' }
    }
    if (!totalDuration || totalDuration <= 0) {
      return { code: -1, message: '服务时长无效' }
    }

    // 1. 获取营业配置
    const configRes = await db.collection('business_config').limit(1).get()
    if (configRes.data.length === 0) {
      return { code: -1, message: '营业配置不存在' }
    }
    const config = configRes.data[0]

    // 2. 检查日期是否在可预约范围内（使用北京时间）
    const now = new Date()
    const bjNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const todayStr = `${bjNow.getUTCFullYear()}-${String(bjNow.getUTCMonth() + 1).padStart(2, '0')}-${String(bjNow.getUTCDate()).padStart(2, '0')}`

    if (date < todayStr) {
      return { code: -1, message: '该日期不在可预约范围内' }
    }

    // 计算相差天数（使用日期字符串比较，避免时区问题）
    const todayParts = todayStr.split('-').map(Number)
    const dateParts = date.split('-').map(Number)
    const todayUtc = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2])
    const targetUtc = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2])
    const diffDays = Math.floor((targetUtc - todayUtc) / (24 * 60 * 60 * 1000))

    if (diffDays > config.max_advance_days) {
      return { code: -1, message: '该日期不在可预约范围内' }
    }

    // 3. 检查是否是休班日
    const holidaysRes = await db.collection('holidays')
      .where({ date: date })
      .get()
    if (holidaysRes.data.length > 0) {
      return { code: 0, data: [] }
    }

    // 4. 获取该日期是周几（1-7，周日为7）
    const targetDateObj = new Date(date + 'T00:00:00')
    const dayOfWeek = targetDateObj.getDay() || 7

    // 5. 获取该日的营业时间段
    const workHours = config.schedule && config.schedule[dayOfWeek]
    if (!workHours || workHours.length === 0) {
      return { code: 0, data: [] }
    }

    // 6. 获取当天上班技师数
    const techRes = await db.collection('technicians')
      .where({ status: 'active' })
      .get()
    let techCount = techRes.data.length

    // 减去当天休假的技师
    const daysOffRes = await db.collection('tech_days_off')
      .where({ date: date })
      .get()
    techCount -= daysOffRes.data.length
    techCount = Math.max(techCount, 0)

    if (techCount === 0) {
      return { code: 0, data: [] }
    }

    // 7. 获取该日所有已有预约（pending状态）
    const appointmentsRes = await db.collection('appointments')
      .where({
        date: date,
        status: 'pending'
      })
      .get()

    const appointments = appointmentsRes.data

    // 8. 生成候选时段
    const slotInterval = config.slot_interval || 30
    const slots = []

    for (const period of workHours) {
      const periodStart = timeToMinutes(period.start)
      const periodEnd = timeToMinutes(period.end)

      for (let time = periodStart; time + totalDuration <= periodEnd; time += slotInterval) {
        const startTime = minutesToTime(time)
        const endTime = minutesToTime(time + totalDuration)

        // 检查该时段的已预约数（前后相接不算冲突）
        let bookedCount = 0
        for (const apt of appointments) {
          const aptStart = timeToMinutes(apt.start_time)
          const aptEnd = timeToMinutes(apt.end_time)
          const slotStart = time
          const slotEnd = time + totalDuration

          // 严格重叠：新时段开始 < 已约结束 且 已约开始 < 新时段结束
          // 前后相接（如 17:30 结束 vs 17:30 开始）不算冲突
          if (slotStart < aptEnd && aptStart < slotEnd) {
            bookedCount++
          }
        }

        const remaining = techCount - bookedCount
        const available = remaining > 0

        // 如果是今天，排除已过去的时段（北京时间）
        if (date === todayStr) {
          const currentMinutes = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes()
          if (time <= currentMinutes) {
            continue
          }
        }

        slots.push({
          time: `${startTime}-${endTime}`,
          remaining: remaining,
          available: available
        })
      }
    }

    return { code: 0, data: slots }
  } catch (err) {
    console.error('获取可用时段失败:', err)
    return { code: -1, message: err.message || '获取时段失败' }
  }
}

// 时间字符串转分钟数
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

// 分钟数转时间字符串
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}
