'use client'

import { useState, useEffect } from 'react'

export function LapTimer() {
  const [isActive, setIsActive] = useState(false)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [laps, setLaps] = useState<{ lap: number; time: number; elapsed: number }[]>([])

  function start() {
    const now = performance.now()
    setIsActive(true)
    setStartTime(now)
    setLaps([])
  }

  function lap() {
    if (!startTime) return
    const now = performance.now()
    const elapsed = now - startTime
    const lapNumber = laps.length + 1
    
    setLaps([...laps, { lap: lapNumber, time: now, elapsed }])
  }

  function reset() {
    setIsActive(false)
    setStartTime(null)
    setLaps([])
  }

  if (!isActive) {
    return (
      <button
        onClick={start}
        className="fixed bottom-4 right-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 z-50"
      >
        Start Timer
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border border-gray-300 p-4 max-w-sm z-50">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-gray-900">Lap Timer</h3>
        <button
          onClick={reset}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
        {laps.map((item) => (
          <div key={item.lap} className="flex justify-between text-sm">
            <span className="text-gray-600">Lap {item.lap}:</span>
            <span className="font-mono font-semibold text-gray-900">
              {item.elapsed.toFixed(0)}ms
            </span>
            {item.lap > 1 && (
              <span className="text-xs text-gray-500 ml-2">
                (+{(item.elapsed - laps[item.lap - 2].elapsed).toFixed(0)}ms)
              </span>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={lap}
        className="w-full px-3 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700 text-sm"
      >
        📍 Lap ({laps.length})
      </button>
    </div>
  )
}
