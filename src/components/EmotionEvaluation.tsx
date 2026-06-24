import { useEffect, useMemo } from "react";
import { EmotionEngine } from "../rules/EmotionEngine";
import type { EmotionAnswers, EmotionEvaluation as Result } from "../types";
import { Card } from "./Card";

interface Props {
  answers: EmotionAnswers;
  onChange: (answers: EmotionAnswers) => void;
  onEvaluation: (evaluation: Result) => void;
}

export function EmotionEvaluation({ answers, onChange, onEvaluation }: Props) {
  const result = useMemo(() => new EmotionEngine().evaluate(answers), [answers]);
  const statusStyle = {
    SAFE: "border-lime-400/30 bg-lime-400/10 text-lime-300",
    COOLDOWN: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    TRADE_DENIED: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  }[result.status];

  useEffect(() => onEvaluation(result), [onEvaluation, result]);

  const toggle = (key: keyof Omit<EmotionAnswers, "greedScore">, label: string) => (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-zinc-800 p-3">
      <span className="text-sm text-zinc-300">{label}</span>
      <input
        type="checkbox"
        checked={answers[key]}
        onChange={(event) => onChange({ ...answers, [key]: event.target.checked })}
        className="h-4 w-4 accent-lime-400"
      />
    </label>
  );

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white">Emotion check</p>
          <p className="mt-1 text-xs text-zinc-500">Answer honestly. The system has no ego.</p>
        </div>
        <span className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${statusStyle}`}>
          {result.status.replace("_", " ")}
        </span>
      </div>
      <label className="mt-5 block text-sm text-zinc-300">
        Greed score: <strong className="text-white">{answers.greedScore}/10</strong>
        <input
          type="range"
          min="1"
          max="10"
          value={answers.greedScore}
          onChange={(event) =>
            onChange({ ...answers, greedScore: Number(event.target.value) })
          }
          className="mt-3 w-full accent-lime-400"
        />
      </label>
      <div className="mt-4 space-y-2">
        {toggle("recoveringLosses", "Are you trying to recover losses?")}
        {toggle("missedPreviousMove", "Did you miss the previous move?")}
        {toggle("increasingLotSize", "Are you increasing your normal lot size?")}
      </div>
      {result.status !== "SAFE" && (
        <ul className="mt-4 list-inside list-disc text-xs leading-5 text-zinc-400">
          {result.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
