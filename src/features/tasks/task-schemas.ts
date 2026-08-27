import { z } from "zod";

export const taskPrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const taskIdSchema = z.uuid();
export const taskStatusSchema = z.enum(["pending", "in_progress", "completed", "dismissed"]);

export const batchTaskStatusSchema = z.object({
  taskIds: z.array(z.uuid()).min(1).max(50).transform((ids) => [...new Set(ids)]),
  targetStatus: z.enum(["pending", "completed"]),
}).strict();

export const moveTaskSchema = z.object({
  taskId: z.uuid(),
  direction: z.enum(["up", "down"]),
}).strict();

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  steps: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
  plannedDate: z.iso.date(),
  estimatedMinutes: z.number().int().min(5).max(1440),
  completionCriteria: z.string().trim().min(1).max(500),
  priority: taskPrioritySchema,
});

export const proposedTaskSchema = taskInputSchema.extend({
  clientId: z.string().trim().min(1).max(120),
  selected: z.boolean(),
  order: z.number().int().min(0),
});

export const commitTasksInputSchema = z.object({
  sourceReportId: z.uuid(),
  sourceVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(160),
  tasks: z.array(proposedTaskSchema).max(50),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  value.tasks.forEach((task, index) => {
    if (seen.has(task.clientId)) {
      context.addIssue({
        code: "custom",
        message: "DUPLICATE_TASK_CLIENT_ID",
        path: ["tasks", index, "clientId"],
      });
    }
    seen.add(task.clientId);
  });
});

export const taskUpdateSchema = taskInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "TASK_UPDATE_EMPTY",
);

export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ProposedTask = z.infer<typeof proposedTaskSchema>;
export type CommitTasksInput = z.infer<typeof commitTasksInputSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
