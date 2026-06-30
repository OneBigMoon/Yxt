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
        <el-menu-item
          v-for="item in visibleMenus"
          :key="item.index"
          :index="item.index"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
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
              <span class="admin-role">{{ roleLabel }}</span>
              <span>{{ adminDisplayName }}</span>
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
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
import {
  ArrowDown,
  Calendar,
  DataBoard,
  Document,
  Goods,
  Money,
  Setting,
  User,
  UserFilled
} from '@element-plus/icons-vue'
import {
  clearAdminInfo,
  getAdminInfo,
  getAdminRole,
  getRoleLabel,
  hasRoutePermission
} from './utils/permissions'

const currentRoute = useRoute()
const router = useRouter()
const activeMenu = computed(() => currentRoute.path)
const menuItems = [
  { index: '/', title: '仪表盘', icon: DataBoard },
  { index: '/appointments', title: '预约管理', icon: Calendar },
  { index: '/customers', title: '客户管理', icon: User },
  { index: '/articles', title: '健康小知识', icon: Document },
  { index: '/services', title: '服务管理', icon: Goods },
  { index: '/technicians', title: '技师管理', icon: UserFilled },
  { index: '/rest-management', title: '休息管理', icon: Calendar },
  { index: '/business-config', title: '营业设置', icon: Setting },
  { index: '/commissions', title: '提成统计', icon: Money },
  { index: '/admin-users', title: '管理员账号', icon: User }
]
const currentRole = computed(() => getAdminRole())
const roleLabel = computed(() => getRoleLabel(currentRole.value))
const adminInfo = computed(() => getAdminInfo())
const adminDisplayName = computed(() => adminInfo.value.username || '管理员')
const visibleMenus = computed(() => (
  menuItems.filter(item => hasRoutePermission(item.index, currentRole.value))
))

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    sessionStorage.removeItem('admin_loggedin')
    sessionStorage.removeItem('admin_password')
    sessionStorage.removeItem('admin_token')
    clearAdminInfo()
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
  gap: 6px;
}

.admin-role {
  color: #909399;
  font-size: 12px;
}

.app-main {
  background-color: #f5f5f5;
  padding: 20px;
}
</style>
