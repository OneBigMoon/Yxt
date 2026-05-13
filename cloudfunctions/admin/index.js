const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { action, data, id } = event

  try {
    switch (action) {
      // 获取营业配置
      case 'getConfig':
        return await getConfig()

      // 更新营业配置
      case 'updateConfig':
        return await updateConfig(data)

      // 服务管理
      case 'getServices':
        return await getServices()
      case 'createService':
        return await createService(data)
      case 'updateService':
        return await updateService(data)

      // 技师管理
      case 'getTechnicians':
        return await getTechnicians()
      case 'createTechnician':
        return await createTechnician(data)
      case 'updateTechnician':
        return await updateTechnician(data)
      case 'toggleTechnicianStatus':
        return await toggleTechnicianStatus(data)

      // 客户管理
      case 'getCustomers':
        return await getCustomers(data)
      case 'updateCustomer':
        return await updateCustomer(data)
      case 'deleteCustomer':
        return await deleteCustomer(data)
      case 'toggleBlacklist':
        return await toggleBlacklist(data)

      // 预约管理
      case 'getAppointments':
        return await getAdminAppointments(data)
      case 'getAppointmentDetail':
        return await getAppointmentDetail(data)

      // 休息管理
      case 'getHolidays':
        return await getHolidays(data)
      case 'addHoliday':
        return await addHoliday(data)
      case 'deleteHoliday':
        return await deleteHoliday(data)
      case 'getTechDaysOff':
        return await getTechDaysOff()
      case 'addTechDayOff':
        return await addTechDayOff(data)
      case 'deleteTechDayOff':
        return await deleteTechDayOff(data)

      // 提成统计
      case 'getCommissions':
        return await getCommissions(data)
      case 'getCommissionSummary':
        return await getCommissionSummary(data)

      // 文章管理
      case 'getArticles':
        return await getArticles()
      case 'createArticle':
        return await createArticle(data)
      case 'updateArticle':
        return await updateArticle(data)
      case 'toggleArticleStatus':
        return await toggleArticleStatus(data)

      // 导入法定节假日
      case 'importHolidays':
        return await importHolidays()

      default:
        return { code: -1, message: '未知操作' }
    }
  } catch (err) {
    console.error(`操作 ${action} 失败:`, err)
    return { code: -1, message: err.message || '操作失败' }
  }
}

// ==================== 营业配置 ====================

async function getConfig() {
  const res = await db.collection('business_config').limit(1).get()
  if (res.data.length === 0) {
    // 创建默认配置
    const defaultConfig = {
      store: {
        name: 'XX中医门诊',
        phone: '010-12345678',
        address: 'XX市XX区XX路XX号',
        latitude: 39.9042,
        longitude: 116.4074
      },
      schedule: {
        1: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        2: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        3: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        4: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        5: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        6: [{ start: '09:00', end: '12:00' }],
        7: []
      },
      slot_interval: 30,
      holidays: [],
      max_advance_days: 14
    }

    await db.collection('business_config').add({ data: defaultConfig })
    return { code: 0, data: defaultConfig }
  }

  return { code: 0, data: res.data[0] }
}

async function updateConfig(data) {
  const res = await db.collection('business_config').limit(1).get()

  if (res.data.length === 0) {
    await db.collection('business_config').add({ data })
  } else {
    await db.collection('business_config')
      .doc(res.data[0]._id)
      .update({ data })
  }

  return { code: 0, data: { message: '更新成功' } }
}

// ==================== 服务管理 ====================

async function getServices() {
  const res = await db.collection('services')
    .where({ status: _.neq('deleted') })
    .orderBy('sort_order', 'asc')
    .get()

  // 转换 cloud:// 图片链接为 https 临时链接
  const cloudIds = res.data
    .map(s => s.image_url || s.imageUrl)
    .filter(u => u && u.startsWith('cloud://'))

  if (cloudIds.length > 0) {
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: cloudIds })
      const urlMap = {}
      urlRes.fileList.forEach(f => { urlMap[f.fileID] = f.tempFileURL })
      res.data.forEach(s => {
        const key = s.image_url || s.imageUrl
        if (key && urlMap[key]) {
          s.image_url = urlMap[key]
        }
      })
    } catch (e) {
      console.error('转换图片链接失败:', e.message)
    }
  }

  return { code: 0, data: res.data }
}

async function createService(data) {
  const res = await db.collection('services').add({
    data: {
      ...data,
      status: 'active',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function updateService(data) {
  const { id, ...updateData } = data
  if (!id) {
    return { code: -1, message: '缺少必要参数: id' }
  }

  // 统一图片字段为 image_url
  if (updateData.imageUrl !== undefined) {
    updateData.image_url = updateData.imageUrl
    delete updateData.imageUrl
  }

  await db.collection('services')
    .doc(id)
    .update({
      data: {
        ...updateData,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '更新成功' } }
}

// ==================== 技师管理 ====================

async function getTechnicians() {
  const res = await db.collection('technicians')
    .where({ status: _.neq('deleted') })
    .orderBy('created_at', 'desc')
    .get()

  return { code: 0, data: res.data }
}

async function createTechnician(data) {
  // 检查手机号是否已存在
  const existing = await db.collection('technicians')
    .where({ phone: data.phone })
    .get()

  if (existing.data.length > 0) {
    return { code: -1, message: '该手机号已被注册' }
  }

  const res = await db.collection('technicians').add({
    data: {
      ...data,
      openid: '',
      custom_commissions: {},
      status: 'active',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function updateTechnician(data) {
  const { id, ...updateData } = data
  if (!id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('technicians')
    .doc(id)
    .update({
      data: {
        ...updateData,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '更新成功' } }
}

// ==================== 客户管理 ====================

async function getCustomers(params) {
  const page = (params && params.page) || 1
  const pageSize = (params && params.page_size) || 20

  let conditions = null
  if (params && params.keyword) {
    conditions = _.or([
      { nick_name: db.RegExp({ regexp: params.keyword, options: 'i' }) },
      { phone: db.RegExp({ regexp: params.keyword, options: 'i' }) }
    ])
  }

  let countQuery = db.collection('users')
  let dataQuery = db.collection('users')

  if (conditions) {
    countQuery = countQuery.where(conditions)
    dataQuery = dataQuery.where(conditions)
  }

  const countRes = await countQuery.count()
  const total = countRes.total

  const res = await dataQuery
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  return { code: 0, data: { list: res.data, total } }
}

async function updateCustomer(data) {
  const { id, ...updateData } = data
  if (!id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('users')
    .doc(id)
    .update({
      data: {
        ...updateData,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '更新成功' } }
}

async function deleteCustomer(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('users')
    .doc(data.id)
    .remove()

  return { code: 0, data: { message: '删除成功' } }
}

// ==================== 预约管理 ====================

async function getAdminAppointments(params) {
  const page = (params && params.page) || 1
  const pageSize = (params && params.page_size) || 20

  let conditions = {}
  if (params) {
    if (params.status) {
      conditions.status = params.status
    }
    if (params.technician_id) {
      conditions.technician_id = params.technician_id
    }
    if (params.start_date && params.end_date) {
      conditions.date = _.gte(params.start_date).and(_.lte(params.end_date))
    } else if (params.date) {
      conditions.date = params.date
    }
  }

  let countQuery = db.collection('appointments')
  let dataQuery = db.collection('appointments')

  if (Object.keys(conditions).length > 0) {
    countQuery = countQuery.where(conditions)
    dataQuery = dataQuery.where(conditions)
  }

  const countRes = await countQuery.count()
  const total = countRes.total

  const res = await dataQuery
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // 过滤掉 _init 文档
  const realAppointments = res.data.filter(a => !a._init)

  // 获取关联数据
  const appointments = await Promise.all(realAppointments.map(async (apt) => {
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

    // 获取患者信息
    let patientName = '未知用户'
    if (apt.patient_openid) {
      try {
        const userRes = await db.collection('users')
          .where({ openid: apt.patient_openid })
          .get()
        if (userRes.data.length > 0) {
          patientName = userRes.data[0].nick_name || '未知用户'
        }
      } catch (e) {
        console.error('获取用户信息失败:', e.message)
      }
    }

    return {
      ...apt,
      service_names: serviceNames,
      technician_name: technicianName,
      patient_name: patientName
    }
  }))

  return { code: 0, data: { list: appointments, total } }
}

// ==================== 休息管理 ====================

async function getHolidays(params) {
  let query = db.collection('holidays')

  if (params && params.type) {
    query = query.where({ type: params.type })
  }

  const res = await query
    .orderBy('date', 'asc')
    .get()

  return { code: 0, data: res.data }
}

async function addHoliday(data) {
  // 检查是否已存在
  const existing = await db.collection('holidays')
    .where({ date: data.date, type: data.type })
    .get()

  if (existing.data.length > 0) {
    return { code: -1, message: '该日期已存在' }
  }

  const res = await db.collection('holidays').add({
    data: {
      ...data,
      created_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function deleteHoliday(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('holidays').doc(data.id).remove()
  return { code: 0, data: { message: '删除成功' } }
}

async function getTechDaysOff() {
  const res = await db.collection('tech_days_off')
    .orderBy('date', 'desc')
    .get()

  // 获取技师名称
  const daysOff = await Promise.all(res.data.map(async (item) => {
    let technicianName = ''
    if (item.technician_id) {
      try {
        const techRes = await db.collection('technicians')
          .doc(item.technician_id)
          .get()
        if (techRes.data) {
          technicianName = techRes.data.name
        }
      } catch (e) {
        console.error('获取技师信息失败:', e.message)
      }
    }
    return { ...item, technician_name: technicianName }
  }))

  return { code: 0, data: daysOff }
}

async function addTechDayOff(data) {
  // 检查是否已存在
  const existing = await db.collection('tech_days_off')
    .where({
      technician_id: data.technician_id,
      date: data.date
    })
    .get()

  if (existing.data.length > 0) {
    return { code: -1, message: '该技师当天已有休假记录' }
  }

  const res = await db.collection('tech_days_off').add({
    data: {
      ...data,
      created_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function deleteTechDayOff(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('tech_days_off').doc(data.id).remove()
  return { code: 0, data: { message: '删除成功' } }
}

// ==================== 提成统计 ====================

async function getCommissions(params) {
  const page = (params && params.page) || 1
  const pageSize = (params && params.page_size) || 20

  let conditions = {}
  if (params) {
    if (params.technician_id) {
      conditions.technician_id = params.technician_id
    }
    if (params.start_date && params.end_date) {
      conditions.date = _.gte(params.start_date).and(_.lte(params.end_date))
    }
  }

  let countQuery = db.collection('commission_records')
  let dataQuery = db.collection('commission_records')

  if (Object.keys(conditions).length > 0) {
    countQuery = countQuery.where(conditions)
    dataQuery = dataQuery.where(conditions)
  }

  const countRes = await countQuery.count()
  const total = countRes.total

  const res = await dataQuery
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  return { code: 0, data: { list: res.data, total } }
}

async function getCommissionSummary(params) {
  let conditions = {}
  if (params) {
    if (params.technician_id) {
      conditions.technician_id = params.technician_id
    }
    if (params.start_date && params.end_date) {
      conditions.date = _.gte(params.start_date).and(_.lte(params.end_date))
    }
  }

  let query = db.collection('commission_records')
  if (Object.keys(conditions).length > 0) {
    query = query.where(conditions)
  }

  const res = await query.get()

  const total = res.data.reduce((sum, item) => sum + (item.commission_amount || 0), 0)
  const count = res.data.length

  return { code: 0, data: { total, count } }
}

// ==================== 文章管理 ====================

async function getArticles() {
  const res = await db.collection('articles')
    .where({ status: _.neq('deleted') })
    .orderBy('sort_order', 'asc')
    .get()

  return { code: 0, data: res.data }
}

async function createArticle(data) {
  const res = await db.collection('articles').add({
    data: {
      ...data,
      status: data.status || 'draft',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return { code: 0, data: { _id: res._id } }
}

async function updateArticle(data) {
  const { id, ...updateData } = data
  if (!id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('articles')
    .doc(id)
    .update({
      data: {
        ...updateData,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '更新成功' } }
}

async function toggleArticleStatus(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('articles')
    .doc(data.id)
    .update({
      data: {
        status: data.status,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '状态更新成功' } }
}

// ==================== 新增功能 ====================

async function getAppointmentDetail(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  const res = await db.collection('appointments').doc(data.id).get()
  const apt = res.data

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
      const techRes = await db.collection('technicians').doc(apt.technician_id).get()
      if (techRes.data) technicianName = techRes.data.name
    } catch (e) {
      console.error('获取技师信息失败:', e.message)
    }
  }

  // 获取患者信息
  let patientName = '未知用户'
  let patientPhone = ''
  if (apt.patient_openid) {
    try {
      const userRes = await db.collection('users')
        .where({ openid: apt.patient_openid })
        .get()
      if (userRes.data.length > 0) {
        patientName = userRes.data[0].nick_name || '未知用户'
        patientPhone = userRes.data[0].phone || ''
      }
    } catch (e) {
      console.error('获取用户信息失败:', e.message)
    }
  }

  return {
    code: 0,
    data: {
      ...apt,
      service_names: serviceNames,
      technician_name: technicianName,
      patient_name: patientName,
      patient_phone: patientPhone
    }
  }
}

async function toggleBlacklist(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('users')
    .doc(data.id)
    .update({
      data: {
        is_blacklisted: data.is_blacklisted,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: data.is_blacklisted ? '已加入黑名单' : '已取消黑名单' } }
}

async function toggleTechnicianStatus(data) {
  if (!data || !data.id) {
    return { code: -1, message: '缺少必要参数: id' }
  }
  await db.collection('technicians')
    .doc(data.id)
    .update({
      data: {
        status: data.status,
        updated_at: db.serverDate()
      }
    })

  return { code: 0, data: { message: '状态更新成功' } }
}

// ==================== 导入法定节假日 ====================

async function importHolidays() {
  // 2026年中国法定节假日
  const holidays = [
    { date: '2026-01-01', reason: '元旦' },
    { date: '2026-02-15', reason: '春节' },
    { date: '2026-02-16', reason: '春节' },
    { date: '2026-02-17', reason: '春节' },
    { date: '2026-02-18', reason: '春节' },
    { date: '2026-02-19', reason: '春节' },
    { date: '2026-02-20', reason: '春节' },
    { date: '2026-02-21', reason: '春节' },
    { date: '2026-04-04', reason: '清明节' },
    { date: '2026-04-05', reason: '清明节' },
    { date: '2026-04-06', reason: '清明节' },
    { date: '2026-05-01', reason: '劳动节' },
    { date: '2026-05-02', reason: '劳动节' },
    { date: '2026-05-03', reason: '劳动节' },
    { date: '2026-05-04', reason: '劳动节' },
    { date: '2026-05-05', reason: '劳动节' },
    { date: '2026-06-19', reason: '端午节' },
    { date: '2026-06-20', reason: '端午节' },
    { date: '2026-06-21', reason: '端午节' },
    { date: '2026-10-01', reason: '国庆节' },
    { date: '2026-10-02', reason: '国庆节' },
    { date: '2026-10-03', reason: '国庆节' },
    { date: '2026-10-04', reason: '中秋节' },
    { date: '2026-10-05', reason: '国庆节' },
    { date: '2026-10-06', reason: '国庆节' },
    { date: '2026-10-07', reason: '国庆节' },
  ]

  let added = 0
  let skipped = 0

  for (const h of holidays) {
    const existing = await db.collection('holidays')
      .where({ date: h.date, type: 'closure' })
      .get()

    if (existing.data.length > 0) {
      skipped++
      continue
    }

    await db.collection('holidays').add({
      data: {
        date: h.date,
        type: 'closure',
        reason: h.reason,
        created_at: db.serverDate()
      }
    })
    added++
  }

  return {
    code: 0,
    data: { message: `导入完成：新增 ${added} 天，跳过 ${skipped} 天已存在记录` }
  }
}
