const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID, APPID } = cloud.getWXContext()
  const { type } = event

  console.log('收到请求:', type)

  try {
    if (type === 'login') {
      const { userInfo, phoneCode } = event

      let phoneNumber = ''

      if (phoneCode) {
        try {
          const phoneRes = await Promise.race([
            cloud.openapi.phonenumber.getPhoneNumber({ code: phoneCode }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('获取手机号超时')), 5000))
          ])
          console.log('手机号返回:', JSON.stringify(phoneRes))
          if (phoneRes && phoneRes.errcode === 0 && phoneRes.phone_info) {
            phoneNumber = phoneRes.phone_info.phoneNumber
          }
        } catch (err) {
          console.error('获取手机号失败(不影响登录):', err.message || err)
        }
      }

      let role = 'patient'
      let technicianInfo = null

      if (phoneNumber) {
        try {
          const techRes = await db.collection('technicians')
            .where({
              phone: phoneNumber,
              status: 'active'
            })
            .get()

          if (techRes.data.length > 0) {
            role = 'technician'
            technicianInfo = techRes.data[0]
          }
        } catch (err) {
          console.error('查询技师失败:', err.message || err)
        }
      }

      const userRes = await db.collection('users')
        .where({ openid: OPENID })
        .get()

      let userData

      const loginNickName = userInfo ? userInfo.nickName : '微信用户'
      const loginAvatarUrl = userInfo ? userInfo.avatarUrl : ''

      if (userRes.data.length > 0) {
        const updateData = {
          updated_at: db.serverDate()
        }
        if (loginNickName) updateData.nick_name = loginNickName
        if (loginAvatarUrl) updateData.avatar_url = loginAvatarUrl
        if (phoneNumber) updateData.phone = phoneNumber

        await db.collection('users')
          .doc(userRes.data[0]._id)
          .update({ data: updateData })

        userData = {
          ...userRes.data[0],
          ...updateData,
          role: userRes.data[0].role || role
        }
      } else {
        const newUser = {
          openid: OPENID,
          nick_name: loginNickName,
          avatar_url: loginAvatarUrl,
          phone: phoneNumber || '',
          role: role,
          is_blacklisted: false,
          notes: '',
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
        data: {
          openid: OPENID,
          role: role,
          nick_name: userData.nick_name,
          avatar_url: userData.avatar_url,
          phone: phoneNumber || '',
          technician_id: technicianInfo ? technicianInfo._id : null
        }
      }
    }

    return { code: -1, message: '未知操作: ' + type }
  } catch (err) {
    console.error('登录失败:', err)
    return { code: -1, message: err.message || '登录失败' }
  }
}
