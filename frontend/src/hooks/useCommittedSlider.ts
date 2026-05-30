import { useState } from "react"

/**
 * Keeps a slider responsive while dragging without firing a service call on
 * every pointer move. The thumb follows local state during the drag and the
 * supplied `onCommit` runs once, when the user releases (Radix `onValueCommit`).
 *
 * Returns the value to display (live during drag, entity value otherwise) and
 * props to spread onto <Slider>.
 */
export function useCommittedSlider(entityValue: number, onCommit: (v: number) => void) {
  const [local, setLocal] = useState<number | null>(null)
  const display = local ?? entityValue
  const sliderProps = {
    value: [display],
    onValueChange: ([v]: number[]) => setLocal(v),
    onValueCommit: ([v]: number[]) => {
      setLocal(null)
      onCommit(v)
    },
  }
  return { display, sliderProps }
}
