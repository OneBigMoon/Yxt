<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">预约管理</h2>
    </div>

    <div class="filter-container">
      <div class="filter-item">
        <span class="filter-label">日期范围：</span>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          @change="loadData"
        />
      </div>
      <div class="filter-item">
        <span class="filter-label">状态：</span>
        <el-select v-model="filters.status" placeholder="全部状态" clearable @change="loadData">
          <el-option label="待核销" value="pending" />
          <el-option label="已完成" value="completed" />
          <el-option label="已取消" value="cancelled" />
        </el-select>
      </div>
      <div class="filter-item">
        <span class="filter-label">技师：</span>
        <el-select v-model="filters.technician_id" placeholder="全部技师" clearable @change="loadData">
          <el-option
            v-for="tech in technicians"
            :key="tech._id"
            :label="tech.name"
            :value="tech._id"
          />
        </el-select>
      </div>
      <el-button type="primary" @click="loadData">查询</el-button>
    </div>

    <el-table :data="appointments" border class="table-container">
      <el-table-column prop="date" label="日期" width="120" />
      <el-table-column prop="start_time" label="开始时间" width="100" />
      <el-table-column prop="end_time" label="结束时间" width="100" />
      <el-table-column prop="service_names" label="服务项目" min-width="150" />
      <el-table-column prop="patient_name" label="客户" width="120" />
      <el-table-column prop="technician_name" label="技师" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">
            {{ getStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatTime(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link @click="viewDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="loadData"
        @current-change="loadData"
      />
    </div>

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailVisible" title="预约详情" width="600px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="预约ID">{{ currentAppointment._id }}</el-descriptions-item>
        <el-descriptions-item label="预约日期">{{ currentAppointment.date }}</el-descriptions-item>
        <el-descriptions-item label="预约时段">{{ currentAppointment.start_time }} - {{ currentAppointment.end_time }}</el-descriptions-item>
        <el-descriptions-item label="服务项目">{{ currentAppointment.service_names }}</el-descriptions-item>
        <el-descriptions-item label="客户">{{ currentAppointment.patient_name }}</el-descriptions-item>
        <el-descriptions-item label="技师">{{ currentAppointment.technician_name || '待分配' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="getStatusType(currentAppointment.status)">
            {{ getStatusText(currentAppointment.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="核销时间">{{ formatTime(currentAppointment.verified_at) }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTime(currentAppointment.created_at) }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { appointmentApi, technicianApi } from '../api'

const appointments = ref([])
const technicians = ref([])
const dateRange = ref([])
const filters = ref({
  status: '',
  technician_id: ''
})
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)

const detailVisible = ref(false)
const currentAppointment = ref({})

onMounted(() => {
  loadTechnicians()
  loadData()
})

async function loadTechnicians() {
  try {
    technicians.value = await technicianApi.getList()
  } catch (err) {
    console.error('加载技师列表失败:', err)
    ElMessage.error('加载技师列表失败')
  }
}

async function loadData() {
  try {
    const params = {
      page: currentPage.value,
      page_size: pageSize.value,
      ...filters.value
    }

    if (dateRange.value && dateRange.value.length === 2) {
      params.start_date = dateRange.value[0]
      params.end_date = dateRange.value[1]
    }

    const data = await appointmentApi.getList(params)
    appointments.value = data.list || data
    total.value = data.total || appointments.value.length
  } catch (err) {
    console.error('加载预约数据失败:', err)
    ElMessage.error('加载预约数据失败：' + (err.message || '请检查云开发匿名登录是否已开启'))
  }
}

function viewDetail(row) {
  currentAppointment.value = row
  detailVisible.value = true
}

function formatTime(val) {
  if (!val) return '-'
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getStatusType(status) {
  const types = {
    pending: 'warning',
    completed: 'success',
    cancelled: 'info'
  }
  return types[status] || 'info'
}

function getStatusText(status) {
  const texts = {
    pending: '待核销',
    completed: '已完成',
    cancelled: '已取消'
  }
  return texts[status] || status
}
</script>

<style scoped>
.page-container {
  background-color: #fff;
  border-radius: 4px;
  padding: 20px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}
</style>
