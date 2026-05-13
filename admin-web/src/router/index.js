import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录', public: true }
  },
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: { title: '仪表盘' }
  },
  {
    path: '/appointments',
    name: 'Appointments',
    component: () => import('../views/Appointments.vue'),
    meta: { title: '预约管理' }
  },
  {
    path: '/customers',
    name: 'Customers',
    component: () => import('../views/Customers.vue'),
    meta: { title: '客户管理' }
  },
  {
    path: '/technicians',
    name: 'Technicians',
    component: () => import('../views/Technicians.vue'),
    meta: { title: '技师管理' }
  },
  {
    path: '/services',
    name: 'Services',
    component: () => import('../views/Services.vue'),
    meta: { title: '服务管理' }
  },
  {
    path: '/business-config',
    name: 'BusinessConfig',
    component: () => import('../views/BusinessConfig.vue'),
    meta: { title: '营业设置' }
  },
  {
    path: '/rest-management',
    name: 'RestManagement',
    component: () => import('../views/RestManagement.vue'),
    meta: { title: '休息管理' }
  },
  {
    path: '/commissions',
    name: 'Commissions',
    component: () => import('../views/Commissions.vue'),
    meta: { title: '提成统计' }
  },
  {
    path: '/articles',
    name: 'Articles',
    component: () => import('../views/Articles.vue'),
    meta: { title: '健康小知识' }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const isLoggedIn = sessionStorage.getItem('admin_loggedin') === 'true'

  if (to.meta.public) {
    next()
  } else if (!isLoggedIn) {
    next('/login')
  } else {
    next()
  }
})

export default router
