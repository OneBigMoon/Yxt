const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DEFAULT_NICK_NAME = '微信用户'

async function findActiveTechnicianByPhone(phoneNumber, openid) {
  if (!phoneNumber) {
    return null
  }

  const techRes = await db.collection('technicians')
    .where({
      phone: phoneNumber,
      status: 'active'
    })
    .get()

  const technicianInfo = techRes.data[0] || null
  if (technicianInfo && (!technicianInfo.openid || technicianInfo.openid !== openid)) {
    await db.collection('technicians')
      .doc(technicianInfo._id)
      .update({
        data: { openid, updated_at: db.serverDate() }
      })
  }

  return technicianInfo
}

async function findActiveTechnicianForUser(openid, phoneNumber) {
  const openidTechRes = await db.collection('technicians')
    .where({
      openid,
      status: 'active'
    })
    .get()

  if (openidTechRes.data.length > 0) {
    return openidTechRes.data[0]
  }

  return await findActiveTechnicianByPhone(phoneNumber, openid)
}

function buildLoginData(openid, userData, role, technicianInfo, isNewUser = false) {
  return {
    openid,
    role,
    nick_name: userData.nick_name || DEFAULT_NICK_NAME,
    avatar_url: userData.avatar_url || '',
    phone: userData.phone || '',
    technician_id: technicianInfo ? technicianInfo._id : null,
    isNewUser,
    is_blacklisted: userData.is_blacklisted || false
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { type } = event

  console.log('收到请求:', type)

  try {
    if (type === 'login') {
      const { userInfo, phoneCode } = event

      let phoneNumber = ''

      if (!phoneCode) {
        return { code: -1, message: '请授权手机号完成快捷登录' }
      }

      try {
        const phoneRes = await Promise.race([
          cloud.openapi.phonenumber.getPhoneNumber({ code: phoneCode }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('获取手机号超时')), 5000))
        ])
        const phoneInfo = phoneRes.phone_info || phoneRes.phoneInfo
        const errCode = phoneRes.errcode === undefined ? phoneRes.errCode : phoneRes.errcode
        if (phoneRes && errCode === 0 && phoneInfo && phoneInfo.phoneNumber) {
          phoneNumber = phoneInfo.phoneNumber
          console.log('手机号授权成功')
        }
      } catch (err) {
        console.error('获取手机号失败:', err.message || err)
      }

      if (!phoneNumber) {
        return { code: -1, message: '手机号授权失败，请重新登录' }
      }

      let role = 'patient'
      let technicianInfo = null
      let isNewUser = false

      if (phoneNumber) {
        try {
          technicianInfo = await findActiveTechnicianByPhone(phoneNumber, OPENID)
          if (technicianInfo) {
            role = 'technician'
          }
        } catch (err) {
          console.error('查询技师失败:', err.message || err)
        }
      }

      const userRes = await db.collection('users')
        .where({ openid: OPENID })
        .get()

      let userData

      const loginNickName = userInfo && userInfo.nickName ? userInfo.nickName : DEFAULT_NICK_NAME

      if (userRes.data.length > 0) {
        const updateData = {
          role,
          last_login_at: db.serverDate(),
          updated_at: db.serverDate()
        }
        if (userInfo && userInfo.nickName) updateData.nick_name = loginNickName
        if (!userRes.data[0].nick_name) updateData.nick_name = DEFAULT_NICK_NAME
        if (phoneNumber) updateData.phone = phoneNumber

        await db.collection('users')
          .doc(userRes.data[0]._id)
          .update({ data: updateData })

        userData = {
          ...userRes.data[0],
          ...updateData,
          role: role
        }
      } else {
        isNewUser = true
        const newUser = {
          openid: OPENID,
          nick_name: loginNickName,
          avatar_url: '',
          phone: phoneNumber || '',
          role: role,
          is_blacklisted: false,
          notes: '',
          register_source: 'wechat_phone_quick_login',
          profile_completed: Boolean(userInfo && userInfo.nickName),
          last_login_at: db.serverDate(),
          registered_at: db.serverDate(),
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }

        const addRes = await db.collection('users').add({ data: newUser })
        userData = {
          _id: addRes._id,
          ...newUser
        }
      }

      return {
        code: 0,
        data: buildLoginData(OPENID, userData, role, technicianInfo, isNewUser)
      }
    }

    if (type === 'refresh') {
      const userRes = await db.collection('users')
        .where({ openid: OPENID })
        .get()

      if (userRes.data.length === 0) {
        return { code: 0, data: null }
      }

      const existingUser = userRes.data[0]
      let role = 'patient'
      let technicianInfo = null

      try {
        technicianInfo = await findActiveTechnicianForUser(OPENID, existingUser.phone || '')
        if (technicianInfo) {
          role = 'technician'
        }
      } catch (err) {
        console.error('刷新技师身份失败:', err.message || err)
      }

      const updateData = {
        role,
        updated_at: db.serverDate()
      }
      if (!existingUser.nick_name) {
        updateData.nick_name = DEFAULT_NICK_NAME
      }

      await db.collection('users')
        .doc(existingUser._id)
        .update({ data: updateData })

      return {
        code: 0,
        data: buildLoginData(OPENID, { ...existingUser, ...updateData }, role, technicianInfo, false)
      }
    }

    if (type === 'updateProfile') {
      const { nickName, avatarUrl } = event

      const userRes = await db.collection('users')
        .where({ openid: OPENID })
        .get()

      if (userRes.data.length === 0) {
        return { code: -1, message: '用户不存在' }
      }

      const updateData = { updated_at: db.serverDate() }
      if (nickName) updateData.nick_name = nickName
      if (avatarUrl) updateData.avatar_url = avatarUrl

      await db.collection('users')
        .doc(userRes.data[0]._id)
        .update({ data: updateData })

      return {
        code: 0,
        data: {
          openid: OPENID,
          role: userRes.data[0].role,
          nick_name: nickName || userRes.data[0].nick_name,
          avatar_url: avatarUrl || userRes.data[0].avatar_url || '',
          phone: userRes.data[0].phone || ''
        }
      }
    }

    return { code: -1, message: '未知操作: ' + type }
  } catch (err) {
    console.error('登录失败:', err)
    return { code: -1, message: err.message || '登录失败' }
  }
}
