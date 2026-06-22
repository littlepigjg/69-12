import React, { useState, useEffect, useMemo } from 'react'
import moment from 'moment'
import { FormField, TextInput, SelectInput, Button } from './Form.jsx'

const MINUTE_OPTIONS = [
  { value: '*', label: '每分钟' },
  { value: '*/5', label: '每5分钟' },
  { value: '*/10', label: '每10分钟' },
  { value: '*/15', label: '每15分钟' },
  { value: '*/30', label: '每30分钟' },
  { value: '0', label: '第0分钟' },
  { value: 'custom', label: '自定义...' }
]

const HOUR_OPTIONS = [
  { value: '*', label: '每小时' },
  { value: '*/2', label: '每2小时' },
  { value: '*/3', label: '每3小时' },
  { value: '*/6', label: '每6小时' },
  { value: '*/12', label: '每12小时' },
  { value: '0', label: '0点' },
  { value: '2', label: '凌晨2点' },
  { value: '8', label: '早上8点' },
  { value: '12', label: '中午12点' },
  { value: '18', label: '晚上6点' },
  { value: '22', label: '晚上10点' },
  { value: 'custom', label: '自定义...' }
]

const DAY_OPTIONS = [
  { value: '*', label: '每天' },
  { value: '*/2', label: '每2天' },
  { value: '1', label: '每月1号' },
  { value: '15', label: '每月15号' },
  { value: 'L', label: '每月最后一天' },
  { value: 'custom', label: '自定义...' }
]

const MONTH_OPTIONS = [
  { value: '*', label: '每月' },
  { value: '*/2', label: '每2个月' },
  { value: '*/3', label: '每季度' },
  { value: '*/6', label: '每半年' },
  { value: '1', label: '1月' },
  { value: '2', label: '2月' },
  { value: '3', label: '3月' },
  { value: '4', label: '4月' },
  { value: '5', label: '5月' },
  { value: '6', label: '6月' },
  { value: '7', label: '7月' },
  { value: '8', label: '8月' },
  { value: '9', label: '9月' },
  { value: '10', label: '10月' },
  { value: '11', label: '11月' },
  { value: '12', label: '12月' },
  { value: 'custom', label: '自定义...' }
]

const WEEKDAY_OPTIONS = [
  { value: '*', label: '每天' },
  { value: '1-5', label: '工作日（周一至周五）' },
  { value: '0,6', label: '周末' },
  { value: '0', label: '周日' },
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: 'custom', label: '自定义...' }
]

const PRESETS = [
  { label: '每周日凌晨2点', cron: '0 2 * * 0', duration: 120, desc: '每周日凌晨2点到4点' },
  { label: '每周六凌晨1点', cron: '0 1 * * 6', duration: 180, desc: '每周六凌晨1点到4点' },
  { label: '每周一凌晨3点', cron: '0 3 * * 1', duration: 120, desc: '每周一凌晨3点到5点' },
  { label: '每月1号零点', cron: '0 0 1 * *', duration: 180, desc: '每月1号零点到3点' },
  { label: '每天凌晨2点', cron: '0 2 * * *', duration: 120, desc: '每天凌晨2点到4点' },
  { label: '每天凌晨3点半', cron: '30 3 * * *', duration: 60, desc: '每天凌晨3:30到4:30' },
  { label: '工作日凌晨2点', cron: '0 2 * * 1-5', duration: 120, desc: '工作日凌晨2点到4点' },
  { label: '每小时第0分钟', cron: '0 * * * *', duration: 5, desc: '每小时开始5分钟' }
]

function parseCronField(field) {
  if (field === '*') return { type: 'all' }
  if (field.startsWith('*/')) return { type: 'step', value: parseInt(field.slice(2), 10) }
  if (field.includes('-') && !field.includes(',')) {
    const [start, end] = field.split('-')
    return { type: 'range', start: parseInt(start, 10), end: parseInt(end, 10) }
  }
  if (field.includes(',')) return { type: 'list', value: field }
  return { type: 'single', value: parseInt(field, 10) }
}

function fieldToSelectOption(field, options) {
  if (options.find(o => o.value === field)) return field
  return 'custom'
}

export default function CronBuilder({ value, onChange, duration, onDurationChange, previewCount = 5 }) {
  const [fields, setFields] = useState({
    minute: '0',
    hour: '2',
    dayOfMonth: '*',
    month: '*',
    dayOfWeek: '0'
  })
  const [customFields, setCustomFields] = useState({
    minute: '',
    hour: '',
    dayOfMonth: '',
    month: '',
    dayOfWeek: ''
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [previewTimes, setPreviewTimes] = useState([])
  const [customCron, setCustomCron] = useState('')
  const [useCustomCron, setUseCustomCron] = useState(false)

  useEffect(() => {
    if (value && !useCustomCron) {
      const parts = value.split(/\s+/)
      if (parts.length === 5) {
        setFields({
          minute: fieldToSelectOption(parts[0], MINUTE_OPTIONS),
          hour: fieldToSelectOption(parts[1], HOUR_OPTIONS),
          dayOfMonth: fieldToSelectOption(parts[2], DAY_OPTIONS),
          month: fieldToSelectOption(parts[3], MONTH_OPTIONS),
          dayOfWeek: fieldToSelectOption(parts[4], WEEKDAY_OPTIONS)
        })
        setCustomFields({
          minute: parts[0],
          hour: parts[1],
          dayOfMonth: parts[2],
          month: parts[3],
          dayOfWeek: parts[4]
        })
      }
    } else if (value && useCustomCron) {
      setCustomCron(value)
    }
  }, [])

  const cronExpression = useMemo(() => {
    if (useCustomCron) return customCron

    const getFieldValue = (fieldName, options) => {
      const field = fields[fieldName]
      if (field === 'custom') return customFields[fieldName]
      return field
    }

    return [
      getFieldValue('minute', MINUTE_OPTIONS),
      getFieldValue('hour', HOUR_OPTIONS),
      getFieldValue('dayOfMonth', DAY_OPTIONS),
      getFieldValue('month', MONTH_OPTIONS),
      getFieldValue('dayOfWeek', WEEKDAY_OPTIONS)
   ].join(' ')
  }, [fields, customFields, useCustomCron, customCron])

  useEffect(() => {
    onChange?.(cronExpression)
    fetchPreview()
  }, [cronExpression, duration])

  const fetchPreview = async () => {
    try {
      const res = await fetch('/api/maintenance/cron/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expression: cronExpression,
          duration_minutes: duration || 60,
          count: previewCount
        })
      })
      if (res.ok) {
        const data = await res.json()
        setPreviewTimes(data.windows || [])
      } else {
        setPreviewTimes([])
      }
    } catch (e) {
      setPreviewTimes([])
    }
  }

  const handleFieldChange = (field, val) => {
    setFields(f => ({ ...f, [field]: val }))
    if (val !== 'custom' && !['*'].includes(val)) {
      setCustomFields(f => ({ ...f, [field]: val }))
    }
  }

  const handleCustomFieldChange = (field, val) => {
    setCustomFields(f => ({ ...f, [field]: val }))
  }

  const applyPreset = (preset) => {
    const parts = preset.cron.split(/\s+/)
    if (parts.length === 5) {
      setFields({
        minute: fieldToSelectOption(parts[0], MINUTE_OPTIONS),
        hour: fieldToSelectOption(parts[1], HOUR_OPTIONS),
        dayOfMonth: fieldToSelectOption(parts[2], DAY_OPTIONS),
        month: fieldToSelectOption(parts[3], MONTH_OPTIONS),
        dayOfWeek: fieldToSelectOption(parts[4], WEEKDAY_OPTIONS)
      })
      setCustomFields({
        minute: parts[0],
        hour: parts[1],
        dayOfMonth: parts[2],
        month: parts[3],
        dayOfWeek: parts[4]
      })
      onDurationChange?.(preset.duration)
    }
  }

  const getCronDescription = () => {
    const f = useCustomCron ? parseCron(customCron) : parseCron(cronExpression)
    if (!f) return '无效表达式'
    return describeCron(f)
  }

  const parseCron = (expr) => {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return null
    return {
      minute: parts[0],
      hour: parts[1],
      dayOfMonth: parts[2],
      month: parts[3],
      dayOfWeek: parts[4]
    }
  }

  const describeCron = (cron) => {
    const parts = []
    parts.push(describeField(cron.minute, 'minute'))
    parts.push(describeField(cron.hour, 'hour'))
    parts.push(describeField(cron.dayOfMonth, 'dayOfMonth'))
    parts.push(describeField(cron.month, 'month'))
    parts.push(describeField(cron.dayOfWeek, 'dayOfWeek'))

    return parts.filter(Boolean).join('，')
  }

  const describeField = (value, type) => {
    if (value === '*') return null
    const parsed = parseCronField(value)

    const names = {
      minute: '分钟',
      hour: '小时',
      dayOfMonth: '日期',
      month: '月份',
      dayOfWeek: '星期'
    }

    const unitNames = {
      minute: '分',
      hour: '点',
      dayOfMonth: '号',
      month: '月',
      dayOfWeek: ''
    }

    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六']

    if (parsed.type === 'single') {
      if (type === 'dayOfWeek') {
        return `每周${weekdayNames[parsed.value]}`
      }
      return `每${names[type]}第${parsed.value}${unitNames[type]}`
    }
    if (parsed.type === 'step') {
      return `每${parsed.value}${unitNames[type] || names[type]}`
    }
    if (parsed.type === 'range') {
      if (type === 'dayOfWeek') {
        return `每周${weekdayNames[parsed.start]}到周${weekdayNames[parsed.end]}`
      }
      return `${parsed.start}到${parsed.end}${unitNames[type] || names[type]}`
    }
    if (parsed.type === 'list') {
      return `在${value}${unitNames[type] || names[type]}`
    }
    return null
  }

  const durationOptions = [
    { value: 15, label: '15 分钟' },
    { value: 30, label: '30 分钟' },
    { value: 60, label: '1 小时' },
    { value: 120, label: '2 小时' },
    { value: 180, label: '3 小时' },
    { value: 240, label: '4 小时' },
    { value: 360, label: '6 小时' },
    { value: 480, label: '8 小时' },
    { value: 720, label: '12 小时' },
    { value: 1440, label: '24 小时' }
  ]

  return (
    <div>
      <div style={{
        background: '#f9fafb',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        border: '1px solid #e5e7eb'
      }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, fontWeight: 600 }}>
          快捷预设
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => applyPreset(p)}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                cursor: 'pointer',
                color: '#374151'
              }}
              onMouseEnter={e => {
                e.target.style.background = '#eef2ff'
                e.target.style.borderColor = '#6366f1'
                e.target.style.color = '#4f46e5'
              }}
              onMouseLeave={e => {
                e.target.style.background = '#fff'
                e.target.style.borderColor = '#d1d5db'
                e.target.style.color = '#374151'
              }}
              title={p.desc}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        background: '#f0fdf4',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        border: '1px solid #86efac',
        fontFamily: 'monospace',
        fontSize: 14
      }}>
        <div style={{ fontSize: 11, color: '#166534', marginBottom: 4, fontFamily: 'sans-serif', fontWeight: 600 }}>
          Cron 表达式
        </div>
        <div style={{ color: '#166534', fontSize: 16, fontWeight: 600, letterSpacing: 2 }}>
          {cronExpression}
        </div>
        <div style={{ fontSize: 12, color: '#15803d', marginTop: 6, fontFamily: 'sans-serif' }}>
          {getCronDescription()}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <button
          onClick={() => { setUseCustomCron(!useCustomCron); if (!useCustomCron) setCustomCron(cronExpression) }}
          style={{
            fontSize: 12,
            color: '#6366f1',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline'
          }}
        >
          {useCustomCron ? '← 返回可视化模式' : '使用手动输入模式 →'}
        </button>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            fontSize: 12,
            color: '#6b7280',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0
          }}
        >
          {showAdvanced ? '▲ 收起详情' : '▼ 展开字段详情'}
        </button>
      </div>

      {useCustomCron ? (
        <FormField label="手动输入 Cron 表达式" help="格式: 分 时 日 月 周，例如: 0 2 * * 0 表示每周日凌晨2点">
          <TextInput
            value={customCron}
            onChange={setCustomCron}
            placeholder="0 2 * * 0"
            style={{ fontFamily: 'monospace' }}
          />
        </FormField>
      ) : showAdvanced && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: 12,
          background: '#f9fafb',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          marginBottom: 16
        }}>
          <FormField label="分钟">
            <SelectInput
              value={fields.minute}
              onChange={v => handleFieldChange('minute', v)}
              options={MINUTE_OPTIONS}
            />
          </FormField>
          {fields.minute === 'custom' && (
            <FormField label="分钟（自定义）" help="支持: 0-59, 逗号, 减号, 斜杠">
              <TextInput
                value={customFields.minute}
                onChange={v => handleCustomFieldChange('minute', v)}
                placeholder="例如: 0,15,30,45 或 */5"
                style={{ fontFamily: 'monospace' }}
              />
            </FormField>
          )}

          <FormField label="小时">
            <SelectInput
              value={fields.hour}
              onChange={v => handleFieldChange('hour', v)}
              options={HOUR_OPTIONS}
            />
          </FormField>
          {fields.hour === 'custom' && (
            <FormField label="小时（自定义）" help="支持: 0-23, 逗号, 减号, 斜杠">
              <TextInput
                value={customFields.hour}
                onChange={v => handleCustomFieldChange('hour', v)}
                placeholder="例如: 2,4,6 或 */2"
                style={{ fontFamily: 'monospace' }}
              />
            </FormField>
          )}

          <FormField label="日期">
            <SelectInput
              value={fields.dayOfMonth}
              onChange={v => handleFieldChange('dayOfMonth', v)}
              options={DAY_OPTIONS}
            />
          </FormField>
          {fields.dayOfMonth === 'custom' && (
            <FormField label="日期（自定义）" help="支持: 1-31, 逗号, 减号, 斜杠">
              <TextInput
                value={customFields.dayOfMonth}
                onChange={v => handleCustomFieldChange('dayOfMonth', v)}
                placeholder="例如: 1,15 或 1-10"
                style={{ fontFamily: 'monospace' }}
              />
            </FormField>
          )}

          <FormField label="月份">
            <SelectInput
              value={fields.month}
              onChange={v => handleFieldChange('month', v)}
              options={MONTH_OPTIONS}
            />
          </FormField>
          {fields.month === 'custom' && (
            <FormField label="月份（自定义）" help="支持: 1-12, 逗号, 减号, 斜杠">
              <TextInput
                value={customFields.month}
                onChange={v => handleCustomFieldChange('month', v)}
                placeholder="例如: 1,6,12 或 1-6"
                style={{ fontFamily: 'monospace' }}
              />
            </FormField>
          )}

          <FormField label="星期">
            <SelectInput
              value={fields.dayOfWeek}
              onChange={v => handleFieldChange('dayOfWeek', v)}
              options={WEEKDAY_OPTIONS}
            />
          </FormField>
          {fields.dayOfWeek === 'custom' && (
            <FormField label="星期（自定义）" help="支持: 0-6 (0=周日), 逗号, 减号">
              <TextInput
                value={customFields.dayOfWeek}
                onChange={v => handleCustomFieldChange('dayOfWeek', v)}
                placeholder="例如: 0,6 或 1-5"
                style={{ fontFamily: 'monospace' }}
              />
            </FormField>
          )}
        </div>
      )}

      <FormField label="维护时长">
        <SelectInput
          value={String(duration || 60)}
          onChange={v => onDurationChange?.(parseInt(v, 10))}
          options={durationOptions}
        />
      </FormField>

      {previewTimes.length > 0 && (
        <div style={{
          padding: 12,
          background: '#eff6ff',
          borderRadius: 8,
          border: '1px solid #bfdbfe',
          marginTop: 16
        }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#1e40af',
            marginBottom: 8
          }}>
            🔮 下次 {previewTimes.length} 次执行预览
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {previewTimes.map((w, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  color: '#1e3a8a',
                  fontFamily: 'monospace',
                  padding: '6px 8px',
                  background: '#fff',
                  borderRadius: 4,
                  border: '1px solid #dbeafe'
                }}
              >
                #{i + 1} &nbsp;
                {moment(w.start).format('YYYY-MM-DD HH:mm')}
                {' → '}
                {moment(w.end).format('HH:mm')}
                <span style={{ color: '#64748b', marginLeft: 8 }}>
                  ({Math.round(moment(w.end).diff(moment(w.start), 'minutes'))} 分钟)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
