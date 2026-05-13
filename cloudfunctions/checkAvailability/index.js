const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  try {
    // 1. 获取营业配置
    const configRes = await db.collection('business_config').limit(1).get()
    if (configRes.data.length === 0) {
      return { code: -1, message: '营业配置不存在' }
    }
    const config = configRes.data[0]
    const maxDays = config.max_advance_days || 14
    const slotInterval = config.slot_interval || 30

    // 2. 获取北京时间
    const now = new Date()
    const bjNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const currentMinutes = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes()

    // 3. 获取所有停业日
    const holidaysRes = await db.collection('holidays').get()
    const holidayMap = {}
    for (const h of (holidaysRes.data || [])) {
      holidayMap[h.date] = h.reason || '停业'
    }

    // 4. 获取技师数量
    const techRes = await db.collection('technicians')
      .where({ status: 'active' })
      .get()
    const techCount = techRes.data.length

    // 5. 获取所有技师休假
    const daysOffRes = await db.collection('tech_days_off').get()
    const daysOffMap = {}
    for (const d of (daysOffRes.data || [])) {
      daysOffMap[d.date] = (daysOffMap[d.date] || 0) + 1
    }

    // 6. 获取所有未来预约
    const todayStr = formatDate(bjNow)
    const endDate = new Date(bjNow.getTime() + maxDays * 24 * 60 * 60 * 1000)
    const endStr = formatDate(endDate)

    let allAppointments = []
    try {
      const aptRes = await db.collection('appointments')
        .where({
          date: _.gte(todayStr).and(_.lte(endStr)),
          status: 'pending'
        })
        .get()
      allAppointments = aptRes.data || []
    } catch (e) {
      // 如果查询失败，继续但不考虑已有预约
      console.error('获取预约数据失败:', e.message)
    }

    // 按日期分组预约
    const appointmentsByDate = {}
    for (const apt of allAppointments) {
      if (!appointmentsByDate[apt.date]) appointmentsByDate[apt.date] = []
      appointmentsByDate[apt.date].push(apt)
    }

    // 7. 逐日检查状态
    const dateStatus = {}
    let hasAnyAvailable = false

    for (let d = 0; d <= maxDays; d++) {
      const checkDate = new Date(bjNow.getTime() + d * 24 * 60 * 60 * 1000)
      const dateStr = formatDate(checkDate)

      // 停业日
      if (holidayMap[dateStr]) {
        dateStatus[dateStr] = { status: 'closure', reason: holidayMap[dateStr] }
        continue
      }

      // 休息日
      const dayOfWeek = checkDate.getUTCDay() || 7
      const workHours = config.schedule && config.schedule[dayOfWeek]
      if (!workHours || workHours.length === 0) {
        dateStatus[dateStr] = { status: 'rest' }
        continue
      }

      // 无技师
      let dayTechCount = techCount - (daysOffMap[dateStr] || 0)
      if (dayTechCount <= 0) {
        dateStatus[dateStr] = { status: 'full' }
        continue
      }

      // 检查是否有可用时段（用最小服务时长30分钟检查）
      const minDuration = 30
      const appointments = appointmentsByDate[dateStr] || []
      let hasSlot = false

      for (const period of workHours) {
        const periodStart = timeToMinutes(period.start)
        const periodEnd = timeToMinutes(period.end)

        for (let time = periodStart; time + minDuration <= periodEnd; time += slotInterval) {
          // 今天跳过已过去的时段
          if (d === 0 && time <= currentMinutes) continue

          let bookedCount = 0
          for (const apt of appointments) {
            const aptStart = timeToMinutes(apt.start_time)
            const aptEnd = timeToMinutes(apt.end_time)
            if (time < aptEnd && aptStart < time + minDuration) {
              bookedCount++
            }
          }

          if (dayTechCount - bookedCount > 0) {
            hasSlot = true
            break
          }
        }
        if (hasSlot) break
      }

      if (hasSlot) {
        dateStatus[dateStr] = { status: 'available' }
        hasAnyAvailable = true
      } else {
        dateStatus[dateStr] = { status: 'full' }
      }
    }

    return {
      code: 0,
      data: {
        hasAnyAvailable,
        dateStatus,
        message: hasAnyAvailable ? '' : `${maxDays}天内预约已满，请稍后再试`
      }
    }
  } catch (err) {
    console.error('检查可用性失败:', err)
    return { code: -1, message: err.message || '检查失败' }
  }
}

function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

function formatDate(bjDate) {
  const year = bjDate.getUTCFullYear()
  const month = String(bjDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(bjDate.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
