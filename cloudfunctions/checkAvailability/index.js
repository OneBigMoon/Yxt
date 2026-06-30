const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function safeQuery(promise, label) {
  try {
    return await promise
  } catch (err) {
    console.error(`${label} 查询失败:`, err.message || err)
    return null
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { totalDuration } = event

  try {
    // 0. 检查是否被拉黑
    const userRes = await safeQuery(
      db.collection('users')
        .where({ openid: OPENID })
        .get(),
      '用户'
    )

    if (userRes && userRes.data.length > 0 && userRes.data[0].is_blacklisted) {
      return {
        code: 0,
        data: {
          hasAnyAvailable: false,
          dateStatus: {},
          message: '您的账号注册信息有误，请联系门店'
        }
      }
    }

    // 1. 获取营业配置
    const configRes = await db.collection('business_config').limit(1).get()
    if (configRes.data.length === 0) {
      return { code: -1, message: '营业配置不存在' }
    }
    const config = configRes.data[0]

    // 2. 获取基本信息
    const maxDays = config.max_advance_days || 14
    const slotInterval = config.slot_interval || 30

    const now = new Date()
    const bjNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const currentMinutes = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes()

    const todayStr = formatDate(bjNow)
    const endDate = new Date(bjNow.getTime() + maxDays * 24 * 60 * 60 * 1000)
    const endStr = formatDate(endDate)

    // 3. 并发查询：节假日、技师、技师休假、当前待预约
    const [holidayQueryRes, techRes, daysOffRes, aptRes] = await Promise.all([
      safeQuery(
        db.collection('holidays').get(),
        '休业日'
      ),
      safeQuery(
        db.collection('technicians')
          .where({ status: 'active' })
          .get(),
        '技师'
      ),
      safeQuery(
        db.collection('tech_days_off').get(),
        '技师休假'
      ),
      totalDuration
        ? safeQuery(
          db.collection('appointments')
            .where({
              date: _.gte(todayStr).and(_.lte(endStr)),
              status: 'pending'
            })
            .get(),
          '预约'
        )
        : Promise.resolve({ data: [] })
    ])

    const holidaysRes = (holidayQueryRes && holidayQueryRes.data) ? holidayQueryRes.data : []
    const holidaysMap = {}
    holidaysRes.forEach((h) => {
      holidaysMap[h.date] = h.reason || '停业'
    })

    const techResData = (techRes && techRes.data) ? techRes.data : []
    const daysOffResData = (daysOffRes && daysOffRes.data) ? daysOffRes.data : []
    const allAppointments = (aptRes && aptRes.data) ? aptRes.data : []

    // 4. 获取技师数量
    const techCount = techResData.length
    const daysOffMap = {}
    for (const d of daysOffResData) {
      daysOffMap[d.date] = (daysOffMap[d.date] || 0) + 1
    }

    // 按日期分组预约
    const appointmentsByDate = {}
    for (const apt of allAppointments) {
      if (!appointmentsByDate[apt.date]) appointmentsByDate[apt.date] = []
      appointmentsByDate[apt.date].push(apt)
    }

    // 5. 逐日检查状态
    const dateStatus = {}
    let hasAnyAvailable = false

    for (let d = 0; d <= maxDays; d++) {
      const checkDate = new Date(bjNow.getTime() + d * 24 * 60 * 60 * 1000)
      const dateStr = formatDate(checkDate)

      // 停业日
      if (holidaysMap[dateStr]) {
        dateStatus[dateStr] = { status: 'closure', reason: holidaysMap[dateStr] }
        continue
      }

      // 休息日
      const dayOfWeek = checkDate.getUTCDay() || 7
      const workHours = config.schedule && config.schedule[dayOfWeek]
      if (!Array.isArray(workHours) || workHours.length === 0) {
        dateStatus[dateStr] = { status: 'rest' }
        continue
      }

      // 无技师
      let dayTechCount = techCount - (daysOffMap[dateStr] || 0)
      if (dayTechCount <= 0) {
        dateStatus[dateStr] = { status: 'full' }
        continue
      }

      // 检查是否有可用时段
      const minDuration = totalDuration || 30
      const appointments = appointmentsByDate[dateStr] || []
      let hasSlot = false

      for (const period of workHours) {
        const periodStart = timeToMinutes(period && period.start)
        const periodEnd = timeToMinutes(period && period.end)
        if (periodStart === null || periodEnd === null || periodStart >= periodEnd) {
          continue
        }

        for (let time = periodStart; time + minDuration <= periodEnd; time += slotInterval) {
          // 今天跳过已过去的时段
          if (d === 0 && time <= currentMinutes) continue

          let bookedCount = 0
          for (const apt of appointments) {
            if (!apt || !apt.start_time || !apt.end_time) {
              continue
            }
            const aptStart = timeToMinutes(apt.start_time)
            const aptEnd = timeToMinutes(apt.end_time)
            if (aptStart === null || aptEnd === null) {
              continue
            }
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
  if (typeof timeStr !== 'string') {
    return null
  }
  const [hours, minutes] = timeStr.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }
  return hours * 60 + minutes
}

function formatDate(bjDate) {
  const year = bjDate.getUTCFullYear()
  const month = String(bjDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(bjDate.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
