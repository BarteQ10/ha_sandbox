import { useEffect, useRef, useState } from "react"

const LAT = import.meta.env.VITE_LAT ?? "52.23"
const LON = import.meta.env.VITE_LON ?? "21.01"
const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${LAT}&longitude=${LON}` +
  `&hourly=shortwave_radiation,temperature_2m,cloud_cover,weather_code` +
  `&timezone=Europe%2FWarsaw&forecast_days=7`

export interface WeatherHour {
  ts: number         // ms epoch
  ghi: number        // W/m²
  temp: number       // °C
  cloud: number      // 0-100 %
  weatherCode: number  // WMO weather code
}

interface UseWeatherResult {
  hours: WeatherHour[]
  currentHour: WeatherHour | null  // entry matching current clock hour
  loading: boolean
  error: boolean
}

export function useWeather(): UseWeatherResult {
  const [hours, setHours] = useState<WeatherHour[]>([])
  const [currentHour, setCurrentHour] = useState<WeatherHour | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
            weatherCode: data.hourly.weather_code[i] ?? 0,
          })
        )

        // Find the entry closest to now (called here in async fn, not during render)
        const nowMs = Date.now()
        const nowHourTs = nowMs - (nowMs % 3_600_000) // floor to current hour
        const current = parsed.find((h) => h.ts === nowHourTs) ?? parsed[0]

        setHours(parsed)
        setCurrentHour(current)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    timerRef.current = setInterval(load, 60 * 60 * 1000)

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { hours, currentHour, loading, error }
}
