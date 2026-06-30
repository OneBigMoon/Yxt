<template>
  <div class="login-container">
    <div class="login-card">
      <h2 class="login-title">壹心堂中医门诊</h2>
      <p class="login-subtitle">管理后台</p>

      <el-tabs v-model="activeMethod" stretch class="login-tabs">
        <el-tab-pane label="账号密码登录" name="password">
          <el-form :model="form">
            <el-form-item>
              <el-input
                v-model="form.username"
                placeholder="请输入管理员账号"
                size="large"
                @keyup.enter="handlePasswordLogin"
                @input="onInputChanged"
              />
            </el-form-item>
            <el-form-item>
              <el-input
                v-model="form.password"
                type="password"
                placeholder="请输入密码"
                show-password
                size="large"
                @keyup.enter="handlePasswordLogin"
              />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                size="large"
                style="width: 100%;"
                :loading="loading"
                @click="handlePasswordLogin"
              >
                登录
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="扫码登录" name="scan">
          <div class="scan-login">
            <div class="qr-box">
              <img v-if="qrCodeUrl" :src="qrCodeUrl" class="qr-image" alt="扫码登录二维码" />
              <div v-else class="qr-placeholder">
                {{ scanStatusText }}
              </div>
            </div>
            <p class="scan-tip">{{ scanStatusText }}</p>
            <el-button
              size="small"
              :loading="scanLoading"
              @click="startScanLogin"
            >
              {{ sessionId ? '刷新二维码' : '生成二维码' }}
            </el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi, scanLoginApi } from '../api'
import { setAdminInfo } from '../utils/permissions'

const router = useRouter()
const activeMethod = ref('password')
const loading = ref(false)
const scanLoading = ref(false)
const form = ref({ username: '', password: '' })
const qrCodeUrl = ref('')
const sessionId = ref('')
const scanStatusText = ref('点击生成二维码')
const scanExpiresAt = ref(0)
let scanTimer = null
let scanExpireTimer = null

async function handlePasswordLogin() {
  const username = (form.value.username || '').trim()
  const password = form.value.password

  if (!username || !password) {
    ElMessage.warning('请输入管理员账号和密码')
    return
  }

  loading.value = true
  try {
    const result = await authApi.passwordLogin({ username, password })
    doLogin(result)
  } catch (err) {
    ElMessage.error(err.message || '账号或密码错误')
  } finally {
    loading.value = false
  }
}

function doLogin(result) {
  const token = typeof result === 'string' ? result : result && result.token
  if (!token) {
    ElMessage.error('登录失败：云函数未返回会话 token')
    return
  }

  sessionStorage.setItem('admin_loggedin', 'true')
  sessionStorage.setItem('admin_token', token)
  sessionStorage.removeItem('admin_password')
  setAdminInfo({
    username: result.username || form.value.username || '管理员',
    role: result.role || 'super_admin'
  })
  stopPolling()
  stopExpireTimer()
  router.push('/')
}

function onInputChanged() {
  if (typeof form.value.username === 'string') {
    form.value.username = form.value.username.trimStart()
  }
}

async function startScanLogin() {
  if (scanLoading.value) {
    return
  }

  scanLoading.value = true
  stopPolling()
  stopExpireTimer()

  try {
    const session = await scanLoginApi.createSession()
    if (!session || !session.session_id) {
      throw new Error('云函数未返回扫码会话')
    }
    if (activeMethod.value !== 'scan') {
      return
    }

    sessionId.value = session.session_id
    scanExpiresAt.value = Number(session.expires_at || 0)

    if (!session.qr_code_base64) {
      throw new Error('云函数未返回小程序码，请检查微信 AppSecret 或云调用权限配置')
    }

    qrCodeUrl.value = `data:image/png;base64,${session.qr_code_base64}`
    scanStatusText.value = '请用微信扫码，进入小程序后将自动确认'
    startPolling(session.session_id)
    startExpireTimer()
  } catch (err) {
    qrCodeUrl.value = ''
    sessionId.value = ''
    scanExpiresAt.value = 0
    scanStatusText.value = getFriendlyScanError(err)
    ElMessage.error(`创建扫码登录失败：${scanStatusText.value}`)
  } finally {
    scanLoading.value = false
  }
}

function startPolling(id) {
  scanTimer = window.setInterval(async () => {
    try {
      const status = await scanLoginApi.checkSession(id)

      if (status.status === 'confirmed') {
        scanStatusText.value = '已确认，正在登录...'
        const result = await scanLoginApi.scanLogin(id)
        doLogin(result)
        ElMessage.success('扫码登录成功')
        return
      }

      if (status.status === 'expired') {
        scanStatusText.value = '二维码已过期，请刷新'
        stopPolling()
      } else if (status.status === 'rejected') {
        scanStatusText.value = status.reason || status.reject_reason || '扫码登录被拒绝'
        stopPolling()
      }
    } catch (err) {
      scanStatusText.value = getFriendlyScanError(err)
      stopPolling()
    }
  }, 2000)
}

function stopPolling() {
  if (scanTimer) {
    window.clearInterval(scanTimer)
    scanTimer = null
  }
}

function startExpireTimer() {
  if (!scanExpiresAt.value) {
    return
  }

  scanExpireTimer = window.setTimeout(() => {
    scanStatusText.value = '二维码已过期，请刷新'
    stopPolling()
  }, Math.max(0, scanExpiresAt.value - Date.now()))
}

function stopExpireTimer() {
  if (scanExpireTimer) {
    window.clearTimeout(scanExpireTimer)
    scanExpireTimer = null
  }
}

function getFriendlyScanError(err) {
  const message = err && err.message ? err.message : ''
  if (message.includes('network request error') || message.includes('Network Error')) {
    return '云函数网络请求失败，请确认匿名登录、域名白名单和 admin 云函数已部署'
  }
  return message || '二维码生成失败'
}

watch(activeMethod, (method) => {
  if (method === 'scan') {
    if (!sessionId.value || scanStatusText.value.includes('过期') || scanStatusText.value.includes('失败')) {
      startScanLogin()
    }
  } else {
    stopPolling()
  }
})

onUnmounted(() => {
  stopPolling()
  stopExpireTimer()
})
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eef2f0;
}

.login-card {
  background: #fff;
  border-radius: 8px;
  padding: 36px;
  width: 420px;
  box-shadow: 0 18px 50px rgba(35, 45, 40, 0.12);
}

.login-title {
  text-align: center;
  font-size: 24px;
  color: #333;
  margin-bottom: 8px;
}

.login-subtitle {
  text-align: center;
  font-size: 14px;
  color: #999;
  margin-bottom: 20px;
}

.login-tabs {
  min-height: 330px;
}

.scan-login {
  text-align: center;
  padding-top: 18px;
}

.qr-box {
  width: 180px;
  height: 180px;
  margin: 0 auto 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
  overflow: hidden;
}

.qr-image {
  width: 160px;
  height: 160px;
  object-fit: contain;
}

.qr-placeholder {
  color: #999;
  font-size: 13px;
}

.scan-tip {
  color: #666;
  font-size: 13px;
  margin: 0 0 12px;
}
</style>
