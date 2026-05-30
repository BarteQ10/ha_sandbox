import { useEffect, useRef, useState } from "react"

const LAT = import.meta.env.VITE_LAT ?? "52.23"
const LON = import.meta.env.VITE_LON ?? "21.01"
const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${LAT}&longitude=${LON}` +
  `&hourly=shortwave_radiation,temperature_2m,cloud_cover` +
  `&timezone=Europe%2FWarsaw&forecast_days=2`

export interface WeatherHour {
  ts: number       // ms epoch
  ghi: number      // W/m²
  temp: number     // °C
  cloud: number    // 0-100 %
}

interface UseWeatherResult {
  hours: WeatherHour[]
  loading: boolean
  error: boolean
}

export function useWeather(): UseWeatherResult {
  const [hours, setHours] = useState<WeatherHour[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(WEATHER_URL)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        const parsed: WeatherHour[] = data.hourly.time.map(
          (t: string, i: number) => ({
            ts: new Date(t).getTime(),
            ghi: data.hourly.shortwave_radiation[i] ?? 0,
            temp: data.hourly.temperature_2m[i] ?? 0,
            cloud: data.hourly.cloud_cover[i] ?? 0,
          })
        )
        setHours(parsed)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    // Refresh once per hour (Open-Meteo updates hourly)
    timerRef.current = setInterval(load, 60 * 60 * 1000)

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { hours, loading, error }
}
