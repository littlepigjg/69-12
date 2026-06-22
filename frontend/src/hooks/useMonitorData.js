import { useEffect, useRef, useState, useCallback } from 'react'
import useWebSocket from './useWebSocket'

export default function useMonitorData({ onMessage } = {}) {
  const [services, setServices] = useState([])
  const [maintenance, setMaintenance] = useState([])
  const [maintenanceSchedules, setMaintenanceSchedules] = useState([])
  const [lastUpdate, setLastUpdate] = useState(null)
  const [loading, setLoading] = useState(true)

  const handlersRef = useRef({ onMessage })
  handlersRef.current = { onMessage }

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch('/api/services')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setServices(data)
      setLastUpdate(new Date().toISOString())
    } catch (e) {
      console.error('Fetch services error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchMaintenance = useCallback(async () => {
    try {
      const res = await fetch('/api/maintenance')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMaintenance(data)
    } catch (e) {
      console.error('Fetch maintenance error:', e)
    }
  }, [])

  const fetchMaintenanceSchedules = useCallback(async () => {
    try {
      const res = await fetch('/api/maintenance/schedules')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMaintenanceSchedules(data)
    } catch (e) {
      console.error('Fetch maintenance schedules error:', e)
    }
  }, [])

  const ws = useWebSocket('/ws', {
    reconnect: true,
    minReconnectDelay: 1000,
    maxReconnectDelay: 10000
  })

  useEffect(() => {
    const unsub = ws.subscribe((event) => {
      if (event.type !== 'message') return
      const msg = event.data

      handlersRef.current.onMessage?.(msg)

      switch (msg.type) {
        case 'new_check':
        case 'status_change':
        case 'service_update':
        case 'service_deleted':
          fetchServices()
          break
        case 'maintenance_change':
          fetchServices()
          fetchMaintenance()
          fetchMaintenanceSchedules()
          break
        default:
          fetchServices()
      }
    })
    return unsub
  }, [ws, fetchServices, fetchMaintenance, fetchMaintenanceSchedules])

  useEffect(() => {
    fetchServices()
    fetchMaintenance()
    fetchMaintenanceSchedules()
    const timer = setInterval(() => {
      fetchServices()
      fetchMaintenance()
      fetchMaintenanceSchedules()
    }, 30000)
    return () => clearInterval(timer)
  }, [fetchServices, fetchMaintenance, fetchMaintenanceSchedules])

  return {
    services,
    maintenance,
    maintenanceSchedules,
    lastUpdate,
    loading,
    fetchServices,
    fetchMaintenance,
    fetchMaintenanceSchedules,
    connectionState: ws.connectionState,
    isConnected: ws.isConnected,
    isConnecting: ws.isConnecting,
    wsReconnect: ws.reconnectNow
  }
}
