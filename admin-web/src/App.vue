<template>
  <!-- 登录页无布局 -->
  <router-view v-if="currentRoute.path === '/login'" />

  <!-- 主布局 -->
  <el-container v-else class="app-container">
    <el-aside width="200px" class="app-aside">
      <div class="logo">
        <h2>中医门诊</h2>
      </div>
      <el-menu
        :default-active="activeMenu"
        router
        class="sidebar-menu"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409eff"
      >
        <el-menu-item index="/">
          <el-icon><DataBoard /></el-icon>
          <span>仪表盘</span>
        </el-menu-item>
        <el-menu-item index="/appointments">
          <el-icon><Calendar /></el-icon>
          <span>预约管理</span>
        </el-menu-item>
        <el-menu-item index="/customers">
          <el-icon><User /></el-icon>
          <span>客户管理</span>
        </el-menu-item>
        <el-menu-item index="/articles">
          <el-icon><Document /></el-icon>
          <span>健康小知识</span>
        </el-menu-item>
        <el-menu-item index="/services">
          <el-icon><Goods /></el-icon>
          <span>服务管理</span>
        </el-menu-item>
        <el-menu-item index="/technicians">
          <el-icon><UserFilled /></el-icon>
          <span>技师管理</span>
        </el-menu-item>
        <el-menu-item index="/rest-management">
          <el-icon><Calendar /></el-icon>
          <span>休息管理</span>
        </el-menu-item>
        <el-menu-item index="/business-config">
          <el-icon><Setting /></el-icon>
          <span>营业设置</span>
        </el-menu-item>
        <el-menu-item index="/commissions">
          <el-icon><Money /></el-icon>
          <span>提成统计</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <div class="header-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="currentRoute.meta.title">
              {{ currentRoute.meta.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown>
            <span class="el-dropdown-link">
              管理员
              <el-icon class="el-icon--right"><arrow-down /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

const currentRoute = useRoute()
const router = useRouter()
const activeMenu = computed(() => currentRoute.path)

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    sessionStorage.removeItem('admin_loggedin')
    router.push('/login')
    ElMessage.success('已退出登录')
  } catch {
    // 取消
  }
}
</script>

<style scoped>
.app-container {
  height: 100vh;
}

.app-aside {
  background-color: #304156;
  overflow: hidden;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.logo h2 {
  font-size: 18px;
  margin: 0;
}

.sidebar-menu {
  border-right: none;
}

.app-header {
  background-color: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}

.header-left {
  display: flex;
  align-items: center;
}

.header-right {
  display: flex;
  align-items: center;
}

.el-dropdown-link {
  cursor: pointer;
  display: flex;
  align-items: center;
}

.app-main {
  background-color: #f5f5f5;
  padding: 20px;
}
</style>
