export type NextActionStage =
  | "profile"
  | "positioning"
  | "creation"
  | "task"
  | "review";

export type NextActionSource = {
  type: "positioning" | "creation" | "review";
  id: string;
  version: number;
};

export type NextAction = {
  stage: NextActionStage;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  source?: NextActionSource;
};

export type NextActionTaskType =
  | "profile_extract"
  | "positioning_report"
  | "content_plan"
  | "review_report";

export type NextActionFacts = {
  hasProfile: boolean;
  hasPositioning: boolean;
  interview: { href: string; status: "incomplete" | "processing" } | null;
  processingRun: { taskType: NextActionTaskType; href: string } | null;
  failedRun: { taskType: NextActionTaskType; href: string } | null;
  unconfirmedPositioning: { href: string } | null;
  confirmedPositioning: { reportId: string; version: number } | null;
  creationProject: { id: string } | null;
  unsavedTaskSource: { href: string; source: NextActionSource } | null;
  highestPriorityTask: { id: string; title: string } | null;
  publishedWithoutReview: { id: string } | null;
  reviewActionTask: { id: string; title: string } | null;
};

function action(
  stage: NextActionStage,
  title: string,
  detail: string,
  href: string,
  actionLabel: string,
): NextAction {
  return { stage, title, detail, href, actionLabel };
}

function stageForTaskType(taskType: NextActionTaskType): NextActionStage {
  if (taskType === "content_plan") return "creation";
  if (taskType === "review_report") return "review";
  return "positioning";
}

export function resolveNextAction(facts: NextActionFacts): NextAction {
  if (!facts.hasProfile) {
    return action("profile", "完善创作档案", "先补齐你的创作条件", "/me/profile", "去完善");
  }
  if (!facts.hasPositioning) {
    return action("positioning", "确定内容方向", "通过访谈生成候选定位", "/positioning", "开始定位");
  }
  if (facts.interview) {
    return facts.interview.status === "processing"
      ? action("positioning", "正在生成定位结果", "输入已经保存，查看真实处理状态", facts.interview.href, "查看进度")
      : action("positioning", "继续定位访谈", "回答未完成的问题", facts.interview.href, "继续访谈");
  }
  if (facts.processingRun) {
    return action(
      stageForTaskType(facts.processingRun.taskType),
      "正在生成结果",
      "输入已经保存，查看真实处理状态",
      facts.processingRun.href,
      "查看进度",
    );
  }
  if (facts.failedRun) {
    return action(
      stageForTaskType(facts.failedRun.taskType),
      "上次生成未完成",
      "已保留输入，可以安全重试",
      facts.failedRun.href,
      "重新生成",
    );
  }
  if (facts.unconfirmedPositioning) {
    return action(
      "positioning",
      "确认一个定位方向",
      "查看候选并选择最终方向",
      facts.unconfirmedPositioning.href,
      "查看候选",
    );
  }
  if (facts.confirmedPositioning && !facts.creationProject) {
    return action(
      "creation",
      "开始第一次创作",
      "使用已确认定位生成内容方案",
      "/creation/new",
      "开始创作",
    );
  }
  if (facts.unsavedTaskSource) {
    return {
      ...action(
        "task",
        "确认行动任务",
        "选择任务并写入任务中心",
        facts.unsavedTaskSource.href,
        "预览任务",
      ),
      source: facts.unsavedTaskSource.source,
    };
  }
  if (facts.highestPriorityTask) {
    return action(
      "task",
      facts.highestPriorityTask.title,
      "执行当前最高优先级任务",
      `/tasks/${facts.highestPriorityTask.id}`,
      "查看任务",
    );
  }
  if (facts.publishedWithoutReview) {
    return action(
      "review",
      "复盘已发布内容",
      "补充真实数据并生成判断",
      `/reviews/new?source=${facts.publishedWithoutReview.id}`,
      "开始复盘",
    );
  }
  if (facts.reviewActionTask) {
    return action(
      "task",
      facts.reviewActionTask.title,
      "执行复盘后的改进任务",
      `/tasks/${facts.reviewActionTask.id}`,
      "开始执行",
    );
  }
  return action(
    "creation",
    "开始下一轮创作",
    "基于最近结论继续行动",
    "/creation/new",
    "新建创作",
  );
}
