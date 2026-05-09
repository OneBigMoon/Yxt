<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">营业设置</h2>
    </div>

    <el-form :model="config" label-width="120px" style="max-width: 800px;">
      <!-- 店铺信息 -->
      <el-divider content-position="left">店铺信息</el-divider>
      <el-form-item label="店铺名称">
        <el-input v-model="config.store.name" placeholder="请输入店铺名称" />
      </el-form-item>
      <el-form-item label="联系电话">
        <el-input v-model="config.store.phone" placeholder="请输入联系电话" />
      </el-form-item>
      <el-form-item label="店铺地址">
        <el-input v-model="config.store.address" placeholder="请输入店铺地址" />
      </el-form-item>
      <el-form-item label="纬度">
        <el-input-number v-model="config.store.latitude" :precision="6" :step="0.000001" />
      </el-form-item>
      <el-form-item label="经度">
        <el-input-number v-model="config.store.longitude" :precision="6" :step="0.000001" />
      </el-form-item>

      <!-- 营业时间 -->
      <el-divider content-position="left">营业时间</el-divider>
      <el-form-item label="时段间隔(分钟)">
        <el-input-number v-model="config.slot_interval" :min="15" :step="15" />
      </el-form-item>
      <el-form-item label="可预约天数">
        <el-input-number v-model="config.max_advance_days" :min="1" :max="30" />
      </el-form-item>

      <el-form-item
        v-for="day in weekDays"
        :key="day.value"
        :label="day.label"
      >
        <div class="schedule-item">
          <div
            v-for="(period, index) in config.schedule[day.value]"
            :key="index"
            class="period-item"
          >
            <el-time-picker
              v-model="period.start"
              format="HH:mm"
              value-format="HH:mm"
              placeholder="开始时间"
              style="width: 120px;"
            />
            <span style="margin: 0 10px;">至</span>
            <el-time-picker
              v-model="period.end"
              format="HH:mm"
              value-format="HH:mm"
              placeholder="结束时间"
              style="width: 120px;"
            />
            <el-button
              type="danger"
              link
              @click="removePeriod(day.value, index)"
              style="margin-left: 10px;"
            >
              删除
            </el-button>
          </div>
          <el-button
            v-if="config.schedule[day.value].length < 3"
            type="primary"
            link
            @click="addPeriod(day.value)"
          >
            添加时段
          </el-button>
          <el-button
            v-if="config.schedule[day.value].length > 0"
            type="warning"
            link
            @click="clearDay(day.value)"
          >
            设为休息
          </el-button>
        </div>
      </el-form-item>

      <el-form-item>
        <el-button type="primary" @click="saveConfig" :loading="saving">保存设置</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi } from '../api'

const config = ref({
  store: {
    name: '',
    phone: '',
    address: '',
    latitude: 0,
    longitude: 0
  },
  schedule: {
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
    7: []
  },
  slot_interval: 30,
  max_advance_days: 14
})

const saving = ref(false)

const weekDays = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 }
]

onMounted(() => {
  loadConfig()
})

async function loadConfig() {
  try {
    const data = await configApi.get()
    if (data) {
      config.value = {
        store: data.store || config.value.store,
        schedule: data.schedule || config.value.schedule,
        slot_interval: data.slot_interval || 30,
        max_advance_days: data.max_advance_days || 14
      }
    }
  } catch (err) {
    console.error('加载配置失败:', err)
  }
}

function addPeriod(day) {
  config.value.schedule[day].push({
    start: '09:00',
    end: '12:00'
  })
}

function removePeriod(day, index) {
  config.value.schedule[day].splice(index, 1)
}

function clearDay(day) {
  config.value.schedule[day] = []
}

async function saveConfig() {
  saving.value = true
  try {
    await configApi.update(config.value)
    ElMessage.success('保存成功')
  } catch (err) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
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

.schedule-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.period-item {
  display: flex;
  align-items: center;
}
</style>
