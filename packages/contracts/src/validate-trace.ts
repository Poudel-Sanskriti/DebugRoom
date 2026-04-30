import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  ResultSchema,
  type TraceResult,
  type TraceValue,
  type TraceObject,
  type Language,
} from "./index.ts";
const shape = TypeCompiler.Compile(ResultSchema);
export function traceValidationError(
  value: unknown,
  source: { code: string; language: Language },
): string | null {
  if (!shape.Check(value)) return "Trace does not match the supported schema";
  const result = value as TraceResult;
  if (result.language !== source.language)
    return "Trace language does not match the run";
  if (result.complete !== (result.outcome === "completed"))
    return "Trace completeness contradicts its outcome";
  const lineCount = source.code.split(/\r\n|\r|\n/).length;
  const hasReference = (
    entry: TraceValue | undefined,
    objects: Record<string, TraceObject>,
  ) => entry?.kind === "ref" && !Object.hasOwn(objects, entry.id);
  const validObjects = (objects: Record<string, TraceObject>) =>
    Object.entries(objects).every(
      ([id, node]) =>
        id === node.id &&
        !(node.items ?? []).some((item) => hasReference(item, objects)) &&
        !(node.entries ?? []).some(
          (entry) =>
            hasReference(entry.key, objects) ||
            hasReference(entry.value, objects),
        ) &&
        !Object.values(node.attributes ?? {}).some((entry) =>
          hasReference(entry, objects),
        ),
    );
  for (let index = 0; index < result.steps.length; index++) {
    const event = result.steps[index]!;
    if (event.index !== index) return "Trace steps are out of sequence";
    if (
      event.line > lineCount ||
      event.frames.some((frame) => frame.line > lineCount)
    )
      return "Trace source line is outside the submitted program";
    const frameIds = new Set(event.frames.map((frame) => frame.id));
    if (frameIds.size !== event.frames.length || !frameIds.has(event.frameId))
      return "Trace contains inconsistent frame identities";
    if (
      !validObjects(event.objects) ||
      hasReference(event.returnValue, event.objects) ||
      Object.values(event.globals ?? {}).some((value) =>
        hasReference(value, event.objects),
      ) ||
      event.frames.some((frame) =>
        Object.values(frame.locals).some((value) =>
          hasReference(value, event.objects),
        ),
      )
    )
      return "Trace contains unresolved object references";
  }
  if (
    !validObjects(result.objects) ||
    hasReference(result.returnValue, result.objects)
  )
    return "Return value contains unresolved object references";
  return null;
}
