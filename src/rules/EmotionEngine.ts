import type {
  EmotionAnswers,
  EmotionEvaluation,
  EmotionStatus,
} from "../types";

export class EmotionEngine {
  evaluate(answers: EmotionAnswers): EmotionEvaluation {
    if (answers.greedScore < 1 || answers.greedScore > 10) {
      throw new Error("Greed score must be between 1 and 10.");
    }

    const reasons: string[] = [];
    let score = answers.greedScore;

    if (answers.recoveringLosses) {
      score += 5;
      reasons.push("You are trying to recover losses.");
    }
    if (answers.missedPreviousMove) {
      score += 3;
      reasons.push("Fear of missing out is influencing this trade.");
    }
    if (answers.increasingLotSize) {
      score += 6;
      reasons.push("Lot size is being increased.");
    }
    if (answers.greedScore >= 8) {
      reasons.push("Greed is elevated.");
    }

    let status: EmotionStatus = "SAFE";
    if (answers.recoveringLosses || answers.increasingLotSize || score >= 13) {
      status = "TRADE_DENIED";
    } else if (answers.greedScore >= 6 || answers.missedPreviousMove || score >= 8) {
      status = "COOLDOWN";
    }

    if (status === "SAFE") {
      reasons.push("No material emotional warning signs detected.");
    }

    return { status, score, reasons };
  }
}
