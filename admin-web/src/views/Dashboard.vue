<template>
  <div class="dashboard">
    <div class="stats-cards">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-content">
              <div class="stat-icon pending">
                <el-icon><Clock /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ stats.pending }}</div>
                <div class="stat-label">今日待核销</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-content">
              <div class="stat-icon completed">
                <el-icon><CircleCheck /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ stats.completed }}</div>
                <div class="stat-label">今日已核销</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-content">
              <div class="stat-icon total">
                <el-icon><Calendar /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ stats.total }}</div>
                <div class="stat-label">今日总预约</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-content">
              <div class="stat-icon customers">
                <el-icon><User /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ stats.customers }}</div>
                <div class="stat-label">总客户数</div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <el-row :gutter="20" class="chart-row">
      <el-col :span="16">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>本周预约趋势</span>
            </div>
          </template>
          <div class="chart-placeholder">
            <el-empty description="图表功能开发中" />
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>今日预约列表</span>
            </div>
          </template>
          <div class="today-list">
            <div
              v-for="item in todayAppointments"
              :key="item._id"
              class="today-item"
            >
              <div class="item-info">
                <div class="item-time">{{ item.start_time }}</div>
                <div class="item-service">{{ item.service_names }}</div>
              </div>
              <el-tag :type="item.status === 'pending' ? 'warning' : 'success'" size="small">
                {{ item.status === 'pending' ? '待核销' : '已核销' }}
              </el-tag>
            </div>
            <el-empty v-if="todayAppointments.length === 0" description="今日暂无预约" />
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { appointmentApi } from '../api'

const stats = ref({
  pending: 0,
  completed: 0,
  total: 0,
  customers: 0
})

const todayAppointments = ref([])

onMounted(() => {
  loadDashboardData()
})

async function loadDashboardData() {
  try {
    const today = formatDate(new Date())
    const appointments = await appointmentApi.getList({ date: today })

    const pending = appointments.filter(a => a.status === 'pending').length
    const completed = appointments.filter(a => a.status === 'completed').length

    stats.value = {
      pending,
      completed,
      total: appointments.length,
      customers: 0 // TODO: 从API获取
    }

    todayAppointments.value = appointments.slice(0, 10)
  } catch (err) {
    console.error('加载仪表盘数据失败:', err)
  }
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
</script>

<style scoped>
.dashboard {
  padding: 0;
}

.stats-cards {
  margin-bottom: 20px;
}

.stat-card {
  cursor: pointer;
}

.stat-content {
  display: flex;
  align-items: center;
}

.stat-icon {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16px;
}

.stat-icon .el-icon {
  font-size: 28px;
  color: #fff;
}

.stat-icon.pending {
  background: linear-gradient(135deg, #f5a623 0%, #f7c948 100%);
}

.stat-icon.completed {
  background: linear-gradient(135deg, #67c23a 0%, #85ce61 100%);
}

.stat-icon.total {
  background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
}

.stat-icon.customers {
  background: linear-gradient(135deg, #909399 0%, #b1b3b8 100%);
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #333;
  line-height: 1;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  color: #909399;
}

.chart-row {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chart-placeholder {
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.today-list {
  max-height: 400px;
  overflow-y: auto;
}

.today-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.today-item:last-child {
  border-bottom: none;
}

.item-info {
  flex: 1;
}

.item-time {
  font-size: 16px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.item-service {
  font-size: 14px;
  color: #909399;
}
</style>
