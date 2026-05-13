<template>
  <div class="login-container">
    <div class="login-card">
      <h2 class="login-title">壹心堂中医门诊</h2>
      <p class="login-subtitle">管理后台</p>
      <el-form :model="form">
        <el-form-item>
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入管理密码"
            show-password
            size="large"
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            style="width: 100%;"
            :loading="loading"
            @click="handleLogin"
          >
            登录
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { configApi } from '../api'

const router = useRouter()
const loading = ref(false)
const form = ref({ password: '' })

async function handleLogin() {
  if (!form.value.password) {
    ElMessage.warning('请输入密码')
    return
  }

  loading.value = true
  try {
    const config = await configApi.get()
    const correctPassword = config.admin_password || 'admin123'

    if (form.value.password === correctPassword) {
      sessionStorage.setItem('admin_loggedin', 'true')
      router.push('/')
    } else {
      ElMessage.error('密码错误')
    }
  } catch (err) {
    // 如果获取配置失败，使用默认密码
    if (form.value.password === 'admin123') {
      sessionStorage.setItem('admin_loggedin', 'true')
      router.push('/')
    } else {
      ElMessage.error('密码错误')
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-card {
  background: #fff;
  border-radius: 12px;
  padding: 40px;
  width: 360px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
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
  margin-bottom: 30px;
}
</style>
