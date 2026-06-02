import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useHA } from "@/hooks/useHA"
import { useToast } from "@/hooks/useToast"
import { useFloorPlan } from "@/hooks/useFloorPlan"
import { isPlaceable, snap, GRID, type PlanRoom, type PlanLayout } from "@/lib/floorplan"
import type { HassEntity } from "home-assistant-js-websocket"
import {
  Lightbulb, Thermometer, Lock, Unlock, DoorOpen, DoorClosed, AppWindow,
  Activity, AlertTriangle, Bot, Car, ArrowUpDown, Fan, Power, Pencil, Check,
  RotateCcw, X, Wind, Droplets, Gauge, Plus, Settings2, Download, Upload,
} from "lucide-react"

// pure helper — kept exported for tests
export function anyOn(entities: Record<string, HassEntity>, ids: string[]): boolean {
  return ids.some((id) => entities[id]?.state === "on")
}

// ── per-entity marker visual + action ──────────────────────────────────────────

interface Visual { Icon: React.ElementType; color: string; operate?: () => void; pulse?: boolean }

function markerVisual(
  e: HassEntity | undefined,
  callService: (d: string, s: string, data: Record<string, unknown>) => void,
): Visual {
  if (!e) return { Icon: Activity, color: "text-muted-foreground/50" }
  const id = e.entity_id
  const domain = id.split(".")[0]
  const state = e.state
  const dc = (e.attributes?.device_class as string) ?? ""
  const svc = (d: string, s: string) => () => callService(d, s, { entity_id: id })

  if (domain === "lock") {
    const locked = state === "locked"
    return { Icon: locked ? Lock : Unlock, color: locked ? "text-green-500" : "text-yellow-500", operate: svc("lock", locked ? "unlock" : "lock") }
  }
  if (domain === "cover") {
    const closed = state === "closed" || (e.attributes?.current_position as number) === 0
    return { Icon: id.includes("garage") ? Car : ArrowUpDown, color: closed ? "text-muted-foreground" : "text-yellow-500", operate: svc("cover", closed ? "open_cover" : "close_cover") }
  }
  if (domain === "vacuum") {
    const cleaning = state === "cleaning"
    return { Icon: Bot, color: cleaning ? "text-green-500" : "text-muted-foreground", operate: svc("vacuum", cleaning ? "return_to_base" : "start") }
  }
  if (domain === "fan") {
    const on = state === "on"
    return { Icon: Fan, color: on ? "text-sky-500" : "text-muted-foreground", operate: svc("fan", on ? "turn_off" : "turn_on") }
  }
  if (domain === "light" || domain === "input_boolean") {
    const on = state === "on"
    return { Icon: Lightbulb, color: on ? "text-amber-400" : "text-muted-foreground", operate: svc(domain, on ? "turn_off" : "turn_on") }
  }
  if (domain === "switch") {
    const on = state === "on"
    return { Icon: Power, color: on ? "text-green-500" : "text-muted-foreground", operate: svc("switch", on ? "turn_off" : "turn_on") }
  }
  if (domain === "climate") {
    return { Icon: Thermometer, color: state === "heat" ? "text-orange-500" : "text-muted-foreground" }
  }
  if (domain === "binary_sensor") {
    const on = state === "on"
    if (["smoke", "carbon_monoxide", "gas", "moisture"].includes(dc)) {
      return { Icon: AlertTriangle, color: on ? "text-red-500" : "text-muted-foreground/50", pulse: on }
    }
    if (dc === "motion" || dc === "occupancy") return { Icon: Activity, color: on ? "text-blue-400" : "text-muted-foreground" }
    if (dc === "door") return { Icon: on ? DoorOpen : DoorClosed, color: on ? "text-yellow-500" : "text-muted-foreground" }
    return { Icon: AppWindow, color: on ? "text-yellow-500" : "text-muted-foreground" }
  }
  if (domain === "sensor") {
    const ICON: Record<string, React.ElementType> = { humidity: Droplets, carbon_dioxide: Wind, pm25: Wind, aqi: Gauge }
    return { Icon: ICON[dc] ?? Gauge, color: "text-muted-foreground" }
  }
  return { Icon: Activity, color: "text-muted-foreground" }
}

// ── component ───────────────────────────────────────────────────────────────────

export function FloorPlan() {
  const { t } = useTranslation()
  const { entities, callService } = useHA()
  const { layout, addDevice, removeDevice, moveDevice, moveRoom, resizeRoom, addRoom, removeRoom, renameRoom, updateRoom, setLayout, reset } = useFloorPlan()
  const { toast } = useToast()
  const [edit, setEdit] = useState(false)
  const [editingRoom, setEditingRoom] = useState<string | null>(null)

  // Export / import the layout so it can move between browsers/devices.
  const exportLayout = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "ems-floorplan.json"
    a.click()
    URL.revokeObjectURL(url)
  }
  const importLayout = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as PlanLayout
        if (parsed && Array.isArray(parsed.rooms) && Array.isArray(parsed.devices)) {
          setLayout(parsed)
          toast(t("floorplan.imported"), "success")
        } else {
          toast(t("floorplan.importError"), "error")
        }
      } catch {
        toast(t("floorplan.importError"), "error")
      }
    }
    reader.readAsText(file)
  }
  const [drag, setDrag] = useState<{ kind: "device" | "room" | "resize"; id: string; x: number; y: number; w?: number; h?: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const pct = (ev: { clientX: number; clientY: number }) => {
    const r = containerRef.current?.getBoundingClientRect()
    if (!r) return { x: 50, y: 50 }
    return { x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100 }
  }
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

  // Generic pointer-drag: snapped, overlap-aware transient preview; commit on release.
  function beginDrag(e: React.PointerEvent, kind: "device" | "room" | "resize", id: string, anchorX: number, anchorY: number) {
    if (!edit) return
    e.preventDefault(); e.stopPropagation()
    const start = pct(e)
    const offX = start.x - anchorX, offY = start.y - anchorY
    const room = layout.rooms.find((r) => r.id === id)

    const move = (ev: PointerEvent) => {
      const p = pct(ev)
      if (kind === "device") {
        setDrag({ kind, id, x: clamp(snap(p.x - offX), 0, 100), y: clamp(snap(p.y - offY), 0, 100) })
      } else if (kind === "room" && room) {
        const nx = clamp(snap(p.x - offX), 0, 100 - room.w)
        const ny = clamp(snap(p.y - offY), 0, 100 - room.h)
        setDrag({ kind, id, x: nx, y: ny })
      } else if (kind === "resize" && room) {
        const nw = clamp(snap(p.x - room.x), 8, 100 - room.x)
        const nh = clamp(snap(p.y - room.y), 8, 100 - room.y)
        setDrag({ kind, id, x: room.x, y: room.y, w: nw, h: nh })
      }
    }
    const up = () => {
      setDrag((d) => {
        if (d && d.id === id) {
          if (kind === "device") moveDevice(id, d.x, d.y)
          else if (kind === "room") moveRoom(id, d.x, d.y)
          else if (kind === "resize" && d.w != null && d.h != null) resizeRoom(id, d.w, d.h)
        }
        return null
      })
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const toggleRoomLights = (room: PlanRoom) => {
    const on = anyOn(entities, room.lights)
    room.lights.forEach((id) => entities[id] && callService("input_boolean", on ? "turn_off" : "turn_on", { entity_id: id }))
  }

  const num = (id: string, fb: number) => {
    const s = entities[id]?.state
    return s != null && s !== "" ? Number(s) : fb
  }

  // entities available to add (placeable, not already on the plan)
  const placed = new Set(layout.devices.map((d) => d.entity))
  const available = Object.values(entities)
    .filter((e) => isPlaceable(e.entity_id) && !placed.has(e.entity_id))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))

  // toggleable entities a room can control + temperature sources (room editor)
  const entName = (id: string) => (entities[id]?.attributes?.friendly_name as string) ?? id
  const lightOptions = Object.values(entities)
    .filter((e) => /^(light|switch|input_boolean)\./.test(e.entity_id))
    .sort((a, b) => entName(a.entity_id).localeCompare(entName(b.entity_id)))
  const tempOptions = Object.values(entities)
    .filter((e) => e.entity_id.startsWith("input_number.wirtualna_temp_") ||
      (e.entity_id.startsWith("sensor.") && e.attributes?.device_class === "temperature"))
    .sort((a, b) => entName(a.entity_id).localeCompare(entName(b.entity_id)))
  const roomBeingEdited = editingRoom ? layout.rooms.find((r) => r.id === editingRoom) : null

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={edit ? "default" : "outline"} size="sm" onClick={() => setEdit((v) => !v)}>
          {edit ? <Check className="mr-1 h-4 w-4" /> : <Pencil className="mr-1 h-4 w-4" />}
          {edit ? t("floorplan.done") : t("floorplan.edit")}
        </Button>
        {edit && (
          <>
            <select
              value=""
              onChange={(ev) => ev.target.value && addDevice(ev.target.value)}
              className="rounded border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("floorplan.addDevice")}
            >
              <option value="">{t("floorplan.addDevice")}…</option>
              {available.map((e) => (
                <option key={e.entity_id} value={e.entity_id}>
                  {(e.attributes?.friendly_name as string) ?? e.entity_id}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={() => addRoom(t("floorplan.newRoom"))}>
              <Plus className="mr-1 h-4 w-4" />{t("floorplan.addRoom")}
            </Button>
            <Button variant="outline" size="sm" onClick={exportLayout}>
              <Download className="mr-1 h-4 w-4" />{t("floorplan.export")}
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border px-3 text-xs font-medium hover:bg-accent">
              <Upload className="h-4 w-4" />{t("floorplan.import")}
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importLayout(f); e.target.value = "" }}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="mr-1 h-4 w-4" />{t("floorplan.reset")}
            </Button>
          </>
        )}
      </div>

      {/* Plan */}
      <div ref={containerRef} className="relative w-full overflow-hidden rounded-lg border bg-muted/20 select-none"
           style={{ aspectRatio: "16 / 10", touchAction: edit ? "none" : "auto" }}>
        {/* Snap grid (edit mode only) */}
        {edit && (
          <div className="pointer-events-none absolute inset-0 opacity-50" style={{
            backgroundImage:
              "linear-gradient(to right, var(--border) 1px, transparent 1px)," +
              "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
            backgroundSize: `${GRID}% ${GRID * 1.6}%`,
          }} />
        )}
        {/* Rooms */}
        {layout.rooms.map((room) => {
          const moveD = drag?.kind === "room" && drag.id === room.id ? drag : null
          const resizeD = drag?.kind === "resize" && drag.id === room.id ? drag : null
          const x = moveD ? moveD.x : room.x, y = moveD ? moveD.y : room.y
          const w = resizeD?.w ?? room.w, h = resizeD?.h ?? room.h
          const hasLights = room.lights.length > 0
          const lit = hasLights && anyOn(entities, room.lights)
          const common = {
            left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`,
            borderColor: lit ? room.color : "var(--border)",
            backgroundColor: lit ? `${room.color}26` : "transparent",
          }
          const header = edit ? (
            <input
              value={t(room.label)}
              onChange={(ev) => renameRoom(room.id, ev.target.value)}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => ev.stopPropagation()}
              className="w-[85%] rounded bg-background/70 px-1 text-[10px] font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring sm:text-xs"
              aria-label={t("floorplan.roomName")}
            />
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-medium sm:text-xs">
              {hasLights && <Lightbulb className="h-3 w-3 shrink-0" style={{ color: lit ? room.color : undefined }} fill={lit ? room.color : "none"} />}
              <span className="truncate">{t(room.label)}</span>
            </span>
          )
          const footer = room.temp ? (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground sm:text-xs">
              <Thermometer className="h-3 w-3" />{num(room.temp, 21).toFixed(1)}°
            </span>
          ) : null

          if (edit) {
            return (
              <div key={room.id}
                   onPointerDown={(e) => beginDrag(e, "room", room.id, room.x, room.y)}
                   className="absolute flex cursor-move flex-col items-start justify-between rounded-md border-2 border-dashed p-1.5 sm:p-2"
                   style={common}>
                {header}
                {footer}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); removeRoom(room.id) }}
                  className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                  aria-label={t("floorplan.removeRoom")}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setEditingRoom((id) => (id === room.id ? null : room.id)) }}
                  className="absolute bottom-0.5 left-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-card text-muted-foreground hover:text-foreground"
                  aria-label={t("floorplan.editRoom")}
                  title={t("floorplan.editRoom")}
                >
                  <Settings2 className="h-2.5 w-2.5" />
                </button>
                <div
                  onPointerDown={(e) => beginDrag(e, "resize", room.id, room.x + room.w, room.y + room.h)}
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-tl-md border-l border-t border-background bg-primary/70"
                  aria-label={t("floorplan.resize")}
                />
              </div>
            )
          }
          if (!hasLights) {
            return (
              <div key={room.id} className="absolute flex flex-col items-start justify-between rounded-md border-2 p-1.5 sm:p-2" style={common}>
                {header}{footer}
              </div>
            )
          }
          return (
            <button key={room.id} onClick={() => toggleRoomLights(room)}
                    aria-label={`${t(room.label)} — ${t("floorplan.toggleLights")}`}
                    className="absolute flex flex-col items-start justify-between rounded-md border-2 p-1.5 text-left transition-colors sm:p-2"
                    style={common}>
              {header}{footer}
            </button>
          )
        })}

        {/* Device markers */}
        {layout.devices.map((dev) => {
          const d = drag?.kind === "device" && drag.id === dev.id ? drag : null
          const x = d ? d.x : dev.x, y = d ? d.y : dev.y
          const e = entities[dev.entity]
          const vis = markerVisual(e, callService)
          const name = (e?.attributes?.friendly_name as string) ?? dev.entity
          const interactive = !edit && Boolean(vis.operate)
          return (
            <div key={dev.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
              <button
                type="button"
                disabled={!interactive && !edit}
                onClick={() => { if (!edit) vis.operate?.() }}
                onPointerDown={(ev) => beginDrag(ev, "device", dev.id, dev.x, dev.y)}
                title={`${name}${e ? ` — ${e.state}` : ""}`}
                aria-label={name}
                className={`flex h-6 w-6 items-center justify-center rounded-full border bg-card shadow-sm sm:h-7 sm:w-7 ${
                  edit ? "cursor-move ring-1 ring-primary/40" : interactive ? "cursor-pointer hover:bg-accent" : "cursor-default"
                }`}
              >
                <vis.Icon className={`h-3.5 w-3.5 ${vis.color} ${vis.pulse ? "animate-pulse" : ""}`} />
              </button>
              {edit && (
                <button
                  onClick={() => removeDevice(dev.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                  aria-label={t("floorplan.remove")}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Room bindings editor */}
      {edit && roomBeingEdited && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{t(roomBeingEdited.label)}</span>
            <button onClick={() => setEditingRoom(null)} className="ml-auto rounded p-1 hover:bg-accent" aria-label={t("floorplan.done")}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground">{t("floorplan.roomLights")}</p>
          <div className="grid max-h-36 grid-cols-1 gap-0.5 overflow-y-auto rounded border p-1 sm:grid-cols-2">
            {lightOptions.map((e) => {
              const checked = roomBeingEdited.lights.includes(e.entity_id)
              return (
                <label key={e.entity_id} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => updateRoom(roomBeingEdited.id, {
                      lights: checked
                        ? roomBeingEdited.lights.filter((x) => x !== e.entity_id)
                        : [...roomBeingEdited.lights, e.entity_id],
                    })}
                  />
                  <span className="truncate">{entName(e.entity_id)}</span>
                </label>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("floorplan.roomTemp")}</span>
            <select
              value={roomBeingEdited.temp}
              onChange={(ev) => updateRoom(roomBeingEdited.id, { temp: ev.target.value })}
              className="rounded border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t("floorplan.none")}</option>
              {tempOptions.map((e) => (
                <option key={e.entity_id} value={e.entity_id}>{entName(e.entity_id)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {edit ? t("floorplan.editHint") : t("floorplan.hint")}
      </p>
    </div>
  )
}
