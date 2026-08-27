import type { AiOutputByTask, AiTaskType } from "./ai-schemas";

type Environment = Partial<Record<"AI_ADAPTER" | "NODE_ENV" | "LOCAL_RUNTIME_MODE" | "APP_URL", string | undefined>>;
type RetrievedHit = { id: string; sourceId: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function firstUserMessageId(subjectData: unknown) {
  const messages = asRecord(subjectData).messages;
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    const row = asRecord(message);
    if (row.sender === "user" && typeof row.id === "string") return row.id;
  }
  return null;
}

export function isTestAiAdapterEnabled(environment: Environment = process.env) {
  if (environment.AI_ADAPTER !== "test") return false;
  if (environment.NODE_ENV !== "production") return true;
  if (environment.LOCAL_RUNTIME_MODE !== "1" || !environment.APP_URL) return false;
  try {
    const hostname = new URL(environment.APP_URL).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function deterministicAiOutput<K extends AiTaskType>(
  taskType: K,
  subjectData: unknown,
  hits: RetrievedHit[],
): AiOutputByTask[K] {
  if (!isTestAiAdapterEnabled({ AI_ADAPTER: "test", NODE_ENV: "test" })) {
    throw new Error("TEST_AI_ADAPTER_DISABLED");
  }
  const citationPairs = hits.slice(0, 2).map((hit) => ({ itemId: hit.id, sourceId: hit.sourceId }));

  if (taskType === "profile_extract") {
    const evidenceId = firstUserMessageId(subjectData);
    const dimension = evidenceId
      ? { score: 100 as const, value: "来自测试访谈的已确认信息", evidenceMessageIds: [evidenceId] }
      : { score: 0 as const, value: "", evidenceMessageIds: [] };
    return {
      profileDimensions: {
        interestsExperience: dimension,
        skills: dimension,
        resources: dimension,
        availableTime: dimension,
        creationGoal: dimension,
        platformPreference: dimension,
        sustainableSources: dimension,
        constraints: dimension,
      },
      nextQuestion: evidenceId ? null : "你最希望分享哪类真实经历？",
    } as AiOutputByTask[K];
  }

  if (taskType === "positioning_report") {
    const candidates = ["产品学习复盘", "AI 工具实践", "效率方法实验"].map((name) => ({
      name,
      audience: "希望提升工作与学习效率的个人创作者",
      direction: `用真实过程记录${name}，不虚构案例或结果`,
      contentPillars: ["真实过程", "方法拆解", "复盘行动"],
      matchExplanation: "方向来自测试访谈输入，用于自动化流程验证。",
      risks: ["需要持续记录真实过程"],
      citations: citationPairs,
      initialTasks: [0, 1, 2].map((taskIndex) => ({
        title: `整理${name}素材 ${taskIndex + 1}`,
        reason: "把定位结论转换成可执行的小步骤。",
        steps: ["选择一段真实经历", "整理问题与行动", "保存为素材"],
        completionCriteria: "形成一条可复用的真实素材记录。",
        estimatedMinutes: 30,
        priority: (taskIndex === 0 ? 1 : 2) as 1 | 2,
      })),
    }));
    return { candidates } as AiOutputByTask[K];
  }

  if (taskType === "content_plan") {
    const project = asRecord(asRecord(subjectData).project);
    const contentType = project.contentType === "video" || project.contentType === "copy"
      ? project.contentType
      : "article";
    const common = {
      tasks: [{
        title: "完成首版内容",
        reason: "验证内容方向是否清晰。",
        steps: ["整理真实素材", "完成首稿", "发布前自检"],
        completionCriteria: "产出一版可发布内容。",
        estimatedMinutes: 60,
        priority: 1 as const,
      }],
      citations: citationPairs,
      riskNotes: ["只使用可核验的个人经历与数据"],
    };
    if (contentType === "video") {
      return {
        contentType,
        hooks: ["我用一次真实实践验证了这个方法"],
        storyboard: ["问题", "过程", "结果", "下一步"],
        voiceover: "这是一段仅用于端到端测试的确定性口播稿。",
        shootingSteps: ["拍摄问题场景", "录制过程", "补充复盘"],
        ...common,
      } as AiOutputByTask[K];
    }
    if (contentType === "copy") {
      return {
        contentType,
        titleSuggestions: ["一次真实实践后的三个结论"],
        body: "这是仅用于端到端测试的确定性短文，不代表真实运营结果。",
        publishingGuide: ["发布前核对事实与数据"],
        ...common,
      } as AiOutputByTask[K];
    }
    return {
      contentType,
      titleSuggestions: ["一次真实实践后的完整复盘"],
      outline: ["问题", "过程", "结论", "下一步"],
      body: "这是仅用于端到端测试的确定性文章，不代表真实运营结果。",
      imageSuggestions: ["使用自己的过程截图，并先确认隐私信息"],
      ...common,
    } as AiOutputByTask[K];
  }

  return {
    dataSummary: { note: "测试环境使用用户已确认的数据生成" },
    retained: ["保留真实过程和清晰结构"],
    problems: ["样本量有限，不能外推"],
    causes: ["当前仅完成一轮内容验证"],
    actions: [{
      title: "完成下一轮内容实验",
      reason: "用下一条真实内容验证结论。",
      steps: ["选择一个变量", "发布内容", "记录确认后的数据"],
      completionCriteria: "完成发布并保存一份确认后的数据快照。",
      estimatedMinutes: 90,
      priority: 1,
    }],
    citations: citationPairs,
  } as AiOutputByTask[K];
}
