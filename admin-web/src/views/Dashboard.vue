<template>
  <div class="dashboard">
    <!-- 今日营业状态 -->
    <el-card shadow="hover" class="status-card">
      <div class="status-header">
        <div class="status-info">
          <el-icon :size="20" :color="isClosed ? '#F56C6C' : '#67C23A'">
            <component :is="isClosed ? 'CircleClose' : 'CircleCheck'" />
          </el-icon>
          <span class="status-text">今日营业状态：</span>
          <el-tag :type="isClosed ? 'danger' : 'success'" size="large">
            {{ isClosed ? '已停业' : '营业中' }}
          </el-tag>
          <span v-if="closureReason" class="closure-reason">（{{ closureReason }}）</span>
        </div>
        <el-button type="primary" @click="showClosureDialog">设置停业</el-button>
      </div>
    </el-card>

    <!-- 今日预约列表 -->
    <el-card shadow="hover" style="margin-top: 20px;">
      <template #header>
        <div class="card-header">
          <span>今日预约列表</span>
          <el-tag type="info" size="small">共 {{ todayAppointments.length }} 条</el-tag>
        </div>
      </template>
      <el-table :data="todayAppointments" border stripe>
        <el-table-column prop="start_time" label="时间" width="100">
          <template #default="{ row }">
            {{ row.start_time }}-{{ row.end_time }}
          </template>
        </el-table-column>
        <el-table-column prop="service_names" label="服务项目" min-width="150" />
        <el-table-column prop="patient_name" label="客户" width="120" />
        <el-table-column prop="technician_name" label="技师" width="120">
          <template #default="{ row }">
            {{ row.technician_name || '待分配' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'completed' ? 'success' : 'info'" size="small">
              {{ row.status === 'pending' ? '待核销' : row.status === 'completed' ? '已核销' : '已取消' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="todayAppointments.length === 0" description="今日暂无预约" />
    </el-card>

    <!-- 设置停业弹窗 -->
    <el-dialog v-model="closureDialogVisible" title="设置停业" width="500px">
      <el-form :model="closureForm" label-width="80px">
        <el-form-item label="停业日期" required>
          <el-date-picker
            v-model="closureForm.dates"
            type="dates"
            placeholder="选择一个或多个日期"
            value-format="YYYY-MM-DD"
            style="width: 100%;"
          />
        </el-form-item>
        <el-form-item label="停业原因">
          <el-input v-model="closureForm.reason" placeholder="如：节假日休息、设备维护" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="closureDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveClosure">确定停业</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { appointmentApi, restApi } from '../api'

const todayAppointments = ref([])
const todayHoliday = ref(null)
const closureDialogVisible = ref(false)
const closureForm = ref({ dates: [], reason: '' })

const isClosed = computed(() => !!todayHoliday.value)
const closureReason = computed(() => todayHoliday.value?.reason || '')

onMounted(() => {
  loadData()
})

async function loadData() {
  await Promise.all([loadTodayAppointments(), loadTodayStatus()])
}

async function loadTodayAppointments() {
  try {
    const today = formatDate(new Date())
    const result = await appointmentApi.getList({ date: today })
    todayAppointments.value = result.list || result || []
  } catch (err) {
    console.error('加载预约数据失败:', err)
    ElMessage.error('加载预约数据失败')
  }
}

async function loadTodayStatus() {
  try {
    const today = formatDate(new Date())
    const holidays = await restApi.getHolidays({ type: 'closure' })
    todayHoliday.value = (holidays || []).find(h => h.date === today) || null
  } catch (err) {
    console.error('加载营业状态失败:', err)
    ElMessage.error('加载营业状态失败')
  }
}

function showClosureDialog() {
  closureForm.value = { dates: [], reason: '' }
  closureDialogVisible.value = true
}

async function saveClosure() {
  const { dates, reason } = closureForm.value

  if (!dates || dates.length === 0) {
    ElMessage.warning('请选择停业日期')
    return
  }

  let successCount = 0
  let skipCount = 0

  for (const date of dates) {
    try {
      await restApi.addHoliday({ date, type: 'closure', reason: reason || '' })
      successCount++
    } catch (err) {
      if (err.message && err.message.includes('已存在')) {
        skipCount++
      } else {
        console.error(`设置 ${date} 停业失败:`, err)
      }
    }
  }

  closureDialogVisible.value = false

  let msg = `成功设置 ${successCount} 天停业`
  if (skipCount > 0) msg += `，${skipCount} 天已有记录跳过`
  ElMessage.success(msg)

  loadTodayStatus()
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

.status-card {
  background: linear-gradient(135deg, #f5f7fa 0%, #fff 100%);
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-text {
  font-size: 16px;
  color: #333;
}

.closure-reason {
  font-size: 14px;
  color: #909399;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
