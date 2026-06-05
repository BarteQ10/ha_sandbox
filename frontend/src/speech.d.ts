// Minimal Web Speech API typings — the SpeechRecognition interface/constructor
// is not in TypeScript's lib.dom (only SpeechRecognitionEvent is). Declares just
// what the voice assistant uses. See components/Assistant.tsx.
interface SpeechRecognition extends EventTarget {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

declare var SpeechRecognition: { new (): SpeechRecognition }
declare var webkitSpeechRecognition: { new (): SpeechRecognition }
