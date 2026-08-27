import type { ContentPlanOutput } from "./creation-schemas";
import type { CitationView } from "@/features/citations/citation-service";
import { CitationList } from "@/components/ui/citation-list";

type CreationSectionId =
  | "hooks"
  | "storyboard"
  | "voiceover"
  | "shooting-steps"
  | "title-suggestions"
  | "outline"
  | "body"
  | "image-suggestions"
  | "publishing-guide"
  | "risk-notes"
  | "evidence";

function Section({ id, title, children }: { id: CreationSectionId; title: string; children: React.ReactNode }) {
  return <section className="creation-plan__section" data-section={id}><h3>{title}</h3>{children}</section>;
}

function Lines({ values }: { values: string[] }) {
  return values.length ? <ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul> : <p className="creation-plan__empty">暂无</p>;
}

export function ContentPlanView({ plan, citations = [] }: { plan: ContentPlanOutput; citations?: CitationView[] }) {
  return (
    <article className="creation-plan">
      {plan.contentType === "video" ? <>
        <Section id="hooks" title="开头钩子"><Lines values={plan.hooks} /></Section>
        <Section id="storyboard" title="分镜"><Lines values={plan.storyboard} /></Section>
        <Section id="voiceover" title="口播稿"><p>{plan.voiceover}</p></Section>
        <Section id="shooting-steps" title="拍摄步骤"><Lines values={plan.shootingSteps} /></Section>
      </> : null}
      {plan.contentType === "article" ? <>
        <Section id="title-suggestions" title="标题建议"><Lines values={plan.titleSuggestions} /></Section>
        <Section id="outline" title="正文结构"><Lines values={plan.outline} /></Section>
        <Section id="body" title="完整正文"><p>{plan.body}</p></Section>
        <Section id="image-suggestions" title="配图建议"><Lines values={plan.imageSuggestions} /></Section>
      </> : null}
      {plan.contentType === "copy" ? <>
        <Section id="title-suggestions" title="标题建议"><Lines values={plan.titleSuggestions} /></Section>
        <Section id="body" title="完整文案"><p>{plan.body}</p></Section>
        <Section id="publishing-guide" title="发布引导"><Lines values={plan.publishingGuide} /></Section>
      </> : null}
      <Section id="risk-notes" title="风险提醒"><Lines values={plan.riskNotes} /></Section>
      <Section id="evidence" title="参考依据">
        <CitationList citations={citations} emptyDetail="仅基于创作需求、档案与已选素材，暂无匹配案例依据" />
      </Section>
    </article>
  );
}

export function CreationTaskRows({ tasks }: { tasks: ContentPlanOutput["tasks"] }) {
  return <div className="compact-stack">{tasks.map((task) => (
    <label className="creation-task-row compact-card" key={task.id}>
      <input defaultChecked name="selectedTaskIds" type="checkbox" value={task.id} />
      <span><strong>{task.title}</strong><small>{task.plannedDate} · {task.estimatedMinutes} 分钟</small><small className="task-card__steps line-clamp-2">{task.steps.join(" → ")}</small></span>
    </label>
  ))}</div>;
}
