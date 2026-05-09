<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">休息管理</h2>
    </div>

    <el-tabs v-model="activeTab">
      <!-- 店铺停业 -->
      <el-tab-pane label="店铺停业" name="closure">
        <div class="tab-header">
          <el-button type="primary" @click="showAddClosure">添加停业日</el-button>
          <el-button @click="importHolidays">导入法定节假日</el-button>
        </div>

        <el-table :data="closures" border>
          <el-table-column prop="date" label="日期" width="150" />
          <el-table-column prop="reason" label="原因" min-width="200" />
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button type="danger" link @click="deleteClosure(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 技师休假 -->
      <el-tab-pane label="技师休假" name="techOff">
        <div class="tab-header">
          <el-button type="primary" @click="showAddTechOff">添加休假</el-button>
        </div>

        <el-table :data="techDaysOff" border>
          <el-table-column prop="technician_name" label="技师" width="120" />
          <el-table-column prop="date" label="日期" width="150" />
          <el-table-column prop="reason" label="原因" min-width="200" />
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button type="danger" link @click="deleteTechOff(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 添加停业弹窗 -->
    <el-dialog v-model="closureVisible" title="添加停业日" width="500px">
      <el-form :model="closureForm" label-width="80px">
        <el-form-item label="日期" required>
          <el-date-picker
            v-model="closureForm.date"
            type="date"
            placeholder="选择日期"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="closureForm.reason" placeholder="请输入停业原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="closureVisible = false">取消</el-button>
          <el-button type="primary" @click="addClosure">确定</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 添加技师休假弹窗 -->
    <el-dialog v-model="techOffVisible" title="添加技师休假" width="500px">
      <el-form :model="techOffForm" label-width="80px">
        <el-form-item label="技师" required>
          <el-select v-model="techOffForm.technician_id" placeholder="选择技师">
            <el-option
              v-for="tech in technicians"
              :key="tech._id"
              :label="tech.name"
              :value="tech._id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker
            v-model="techOffForm.date"
            type="date"
            placeholder="选择日期"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="techOffForm.reason" placeholder="请输入休假原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="techOffVisible = false">取消</el-button>
          <el-button type="primary" @click="addTechOff">确定</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { restApi, technicianApi } from '../api'

const activeTab = ref('closure')
const closures = ref([])
const techDaysOff = ref([])
const technicians = ref([])

const closureVisible = ref(false)
const closureForm = ref({ date: '', reason: '' })

const techOffVisible = ref(false)
const techOffForm = ref({ technician_id: '', date: '', reason: '' })

onMounted(() => {
  loadClosures()
  loadTechDaysOff()
  loadTechnicians()
})

async function loadClosures() {
  try {
    closures.value = await restApi.getHolidays({ type: 'closure' })
  } catch (err) {
    console.error('加载停业日失败:', err)
  }
}

async function loadTechDaysOff() {
  try {
    const data = await restApi.getTechDaysOff()
    techDaysOff.value = data || []
  } catch (err) {
    console.error('加载技师休假失败:', err)
  }
}

async function loadTechnicians() {
  try {
    technicians.value = await technicianApi.getList()
  } catch (err) {
    console.error('加载技师列表失败:', err)
  }
}

function showAddClosure() {
  closureForm.value = { date: '', reason: '' }
  closureVisible.value = true
}

async function addClosure() {
  if (!closureForm.value.date) {
    ElMessage.warning('请选择日期')
    return
  }

  try {
    await restApi.addHoliday({
      ...closureForm.value,
      type: 'closure'
    })
    ElMessage.success('添加成功')
    closureVisible.value = false
    loadClosures()
  } catch (err) {
    ElMessage.error('添加失败')
  }
}

async function deleteClosure(row) {
  try {
    await ElMessageBox.confirm('确定要删除该停业日吗？', '确认操作', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await restApi.deleteHoliday(row._id)
    ElMessage.success('删除成功')
    loadClosures()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

async function importHolidays() {
  // TODO: 实现法定节假日导入
  ElMessage.info('功能开发中')
}

function showAddTechOff() {
  techOffForm.value = { technician_id: '', date: '', reason: '' }
  techOffVisible.value = true
}

async function addTechOff() {
  if (!techOffForm.value.technician_id || !techOffForm.value.date) {
    ElMessage.warning('请填写完整信息')
    return
  }

  try {
    await restApi.addTechDayOff(techOffForm.value)
    ElMessage.success('添加成功')
    techOffVisible.value = false
    loadTechDaysOff()
  } catch (err) {
    ElMessage.error('添加失败')
  }
}

async function deleteTechOff(row) {
  try {
    await ElMessageBox.confirm('确定要删除该休假记录吗？', '确认操作', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await restApi.deleteTechDayOff(row._id)
    ElMessage.success('删除成功')
    loadTechDaysOff()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}
</script>

<style scoped>
.page-container {
  background-color: #fff;
  border-radius: 4px;
  padding: 20px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.tab-header {
  margin-bottom: 20px;
  display: flex;
  gap: 10px;
}
</style>
