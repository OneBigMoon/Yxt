<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">技师管理</h2>
      <el-button type="primary" @click="showAddDialog">添加技师</el-button>
    </div>

    <el-table :data="technicians" border class="table-container">
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column prop="phone" label="手机号" width="150" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatTime(row.created_at || row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link @click="editTechnician(row)">编辑</el-button>
          <el-button type="primary" link @click="editCommission(row)">设置提成</el-button>
          <el-button
            :type="row.status === 'active' ? 'warning' : 'success'"
            link
            @click="toggleStatus(row)"
          >
            {{ row.status === 'active' ? '禁用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑技师' : '添加技师'" width="500px">
      <el-form :model="formData" label-width="100px">
        <el-form-item label="姓名" required>
          <el-input v-model="formData.name" placeholder="请输入技师姓名" />
        </el-form-item>
        <el-form-item label="手机号" required>
          <el-input v-model="formData.phone" placeholder="请输入手机号" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveTechnician">保存</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 提成设置弹窗 -->
    <el-dialog v-model="commissionVisible" title="设置个人提成" width="600px">
      <el-alert
        title="设置技师个人提成将覆盖服务项目的默认提成"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 20px;"
      />
      <el-table :data="services" border>
        <el-table-column prop="name" label="服务项目" />
        <el-table-column prop="default_commission" label="默认提成(元)" width="120">
          <template #default="{ row }">
            {{ ((row.default_commission || 0) / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column label="个人提成(元)" width="150">
          <template #default="{ row }">
            <el-input-number
              v-model="commissionData[row._id]"
              :min="0"
              :precision="2"
              :step="10"
              size="small"
            />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="commissionVisible = false">取消</el-button>
          <el-button type="primary" @click="saveCommission">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { technicianApi, serviceApi } from '../api'

const technicians = ref([])
const services = ref([])
const dialogVisible = ref(false)
const commissionVisible = ref(false)
const isEdit = ref(false)
const currentId = ref('')

const formData = ref({
  name: '',
  phone: ''
})

const commissionData = ref({})

onMounted(() => {
  loadData()
  loadServices()
})

async function loadData() {
  try {
    technicians.value = await technicianApi.getList()
  } catch (err) {
    console.error('加载技师数据失败:', err)
    ElMessage.error('加载技师数据失败')
  }
}

async function loadServices() {
  try {
    services.value = await serviceApi.getList()
  } catch (err) {
    console.error('加载服务数据失败:', err)
    ElMessage.error('加载服务数据失败')
  }
}

function showAddDialog() {
  isEdit.value = false
  formData.value = { name: '', phone: '' }
  dialogVisible.value = true
}

function editTechnician(row) {
  isEdit.value = true
  currentId.value = row._id
  formData.value = {
    name: row.name,
    phone: row.phone
  }
  dialogVisible.value = true
}

async function saveTechnician() {
  if (!formData.value.name || !formData.value.phone) {
    ElMessage.warning('请填写完整信息')
    return
  }

  try {
    if (isEdit.value) {
      await technicianApi.update(currentId.value, formData.value)
      ElMessage.success('更新成功')
    } else {
      await technicianApi.create(formData.value)
      ElMessage.success('添加成功')
    }
    dialogVisible.value = false
    loadData()
  } catch (err) {
    ElMessage.error('操作失败')
  }
}

async function toggleStatus(row) {
  const newStatus = row.status === 'active' ? 'inactive' : 'active'
  const action = newStatus === 'active' ? '启用' : '禁用'

  try {
    await ElMessageBox.confirm(`确定要${action}该技师吗？`, '确认操作', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await technicianApi.toggleStatus(row._id, newStatus)
    ElMessage.success(`${action}成功`)
    loadData()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('操作失败')
    }
  }
}

function editCommission(row) {
  currentId.value = row._id

  // 初始化提成数据
  const data = {}
  services.value.forEach(service => {
    const custom = row.custom_commissions && row.custom_commissions[service._id]
    data[service._id] = custom != null ? custom / 100 : (service.default_commission || 0) / 100
  })
  commissionData.value = data

  commissionVisible.value = true
}

async function saveCommission() {
  // 验证提成不超过服务价格
  for (const key of Object.keys(commissionData.value)) {
    const commission = commissionData.value[key] || 0
    const service = services.value.find(s => s._id === key)
    const price = service ? (service.price || 0) / 100 : 0
    if (commission > price) {
      ElMessage.warning(`「${service ? service.name : key}」的提成不能大于服务价格（¥${price.toFixed(2)}）`)
      return
    }
  }

  try {
    const custom_commissions = {}
    Object.keys(commissionData.value).forEach(key => {
      custom_commissions[key] = Math.round((commissionData.value[key] || 0) * 100)
    })

    await technicianApi.update(currentId.value, { custom_commissions })
    ElMessage.success('提成设置成功')
    commissionVisible.value = false
    loadData()
  } catch (err) {
    ElMessage.error('保存失败')
  }
}

function formatTime(val) {
  if (!val) return '-'
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
