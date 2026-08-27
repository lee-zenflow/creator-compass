export type RecoveryCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_OUTPUT"
  | "UPSTREAM_ERROR"
  | "QUEUE_UNAVAILABLE"
  | "AI_INPUT_CHANGED"
  | "UNKNOWN";

export type RecoveryState = {
  code: RecoveryCode;
  title: string;
  detail: string;
  action: string;
  retryable: boolean;
};

const states: Record<RecoveryCode, RecoveryState> = {
  NOT_CONFIGURED: {
    code: "NOT_CONFIGURED",
    title: "AI 暂未配置",
    detail: "本次输入已保存，配置完成后可继续生成。",
    action: "返回修改",
    retryable: false,
  },
  TIMEOUT: {
    code: "TIMEOUT",
    title: "生成超时",
    detail: "已保留上次输入，可以直接重新生成。",
    action: "重新生成",
    retryable: true,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    title: "当前请求较多",
    detail: "已保留上次输入，请稍后重新生成。",
    action: "重新生成",
    retryable: true,
  },
  INVALID_OUTPUT: {
    code: "INVALID_OUTPUT",
    title: "生成结果未通过校验",
    detail: "已保留上次输入，可以重新生成一份完整结果。",
    action: "重新生成",
    retryable: true,
  },
  UPSTREAM_ERROR: {
    code: "UPSTREAM_ERROR",
    title: "AI 服务暂时不可用",
    detail: "已保留上次输入，服务恢复后可直接重试。",
    action: "重新生成",
    retryable: true,
  },
  QUEUE_UNAVAILABLE: {
    code: "QUEUE_UNAVAILABLE",
    title: "生成任务暂未开始",
    detail: "已保留上次输入，可以重新提交生成任务。",
    action: "重新生成",
    retryable: true,
  },
  AI_INPUT_CHANGED: {
    code: "AI_INPUT_CHANGED",
    title: "输入内容已更新",
    detail: "旧任务不会覆盖新内容，请返回并使用最新内容生成。",
    action: "使用最新内容重新生成",
    retryable: false,
  },
  UNKNOWN: {
    code: "UNKNOWN",
    title: "生成未完成",
    detail: "上次输入已保留，可以稍后重试。",
    action: "重新生成",
    retryable: true,
  },
};

const knownCodes = new Set<RecoveryCode>([
  "NOT_CONFIGURED",
  "TIMEOUT",
  "RATE_LIMITED",
  "INVALID_OUTPUT",
  "UPSTREAM_ERROR",
  "QUEUE_UNAVAILABLE",
  "AI_INPUT_CHANGED",
]);

export function recoveryFor(rawCode: string | null | undefined, safeDetail?: string | null) {
  if (safeDetail === "AI_INPUT_CHANGED") {
    return states.AI_INPUT_CHANGED;
  }

  if (rawCode && knownCodes.has(rawCode as RecoveryCode)) {
    return states[rawCode as RecoveryCode];
  }

  return states.UNKNOWN;
}
