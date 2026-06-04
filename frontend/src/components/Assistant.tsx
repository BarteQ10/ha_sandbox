import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useHA } from "@/hooks/useHA"
import { parseCommand } from "@/lib/assistant"
import { Bot, Send, User, Mic, Sparkles } from "lucide-react"

interface Msg { role: "user" | "bot"; text: string; ok?: boolean }

// Feature-detect the Web Speech API (Chrome/Edge expose webkitSpeechRecognition).
function getSpeechRecognition(): (new () => SpeechRecognition) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function Assistant() {
  const { t, i18n } = useTranslation()
  const { callService } = useHA()
  const [input, setInput] = useState("")
  const [log, setLog] = useState<Msg[]>([])
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognition | null>(null)

  const examples: string[] = t("assistant.examples", { returnObjects: true }) as unknown as string[]

  async function run(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const result = parseCommand(trimmed)
    if (result) {
      await callService(result.domain, result.service, result.data)
      setLog((l) => [
        ...l,
        { role: "user", text: trimmed },
        { role: "bot", text: t(result.key, result.params), ok: true },
      ])
    } else {
      setLog((l) => [
        ...l,
        { role: "user", text: trimmed },
        { role: "bot", text: t("assistant.unknown"), ok: false },
      ])
    }
    setInput("")
  }

  function toggleVoice() {
    const SR = getSpeechRecognition()
    if (!SR) return
    if (listening) { recRef.current?.stop(); return }
    const rec = new SR()
    rec.lang = i18n.language === "pl" ? "pl-PL" : "en-US"
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const said = e.results[0]?.[0]?.transcript ?? ""
      setInput(said)
      run(said)
    }
    rec.onend = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  const voiceAvailable = getSpeechRecognition() !== null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold sm:text-lg">{t("assistant.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("assistant.hint")}</p>

      {/* Transcript */}
      {log.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-3 sm:p-4">
            {log.map((m, i) => (
              <div key={i} className={`flex items-start gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "bot" && (
                  <Bot className={`mt-0.5 h-4 w-4 shrink-0 ${m.ok === false ? "text-muted-foreground" : "text-primary"}`} />
                )}
                <span
                  className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-sm ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {m.text}
                </span>
                {m.role === "user" && <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Input */}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); run(input) }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("assistant.placeholder")}
          aria-label={t("assistant.placeholder")}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {voiceAvailable && (
          <Button
            type="button"
            variant={listening ? "default" : "outline"}
            size="icon"
            onClick={toggleVoice}
            aria-label={t("assistant.voice")}
          >
            <Mic className={`h-4 w-4 ${listening ? "animate-pulse" : ""}`} />
          </Button>
        )}
        <Button type="submit" className="gap-1.5" disabled={!input.trim()}>
          <Send className="h-4 w-4" />
          {t("assistant.send")}
        </Button>
      </form>

      {/* Example chips */}
      <div className="flex flex-wrap gap-1.5">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => run(ex)}
            className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}
